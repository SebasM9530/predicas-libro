import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import TextStyle from '@tiptap/extension-text-style';
import { Extension } from '@tiptap/core';
import { SugerenciaMark, SeccionMark } from './SugerenciaMark';
import { actualizarTextoCapitulo } from '../../services/api';

const AUTOSAVE_DEBOUNCE_MS = 3000;
const AUTOSAVE_FORZADO_MS = 30000;

// Extensión manual de fontSize compatible con Tiptap v2
const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
});

function normalizarEspacios(texto) {
  if (!texto) return '';
  return texto.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

function mapearPosicionTexto(editor, desde, hasta) {
  let acumulado = 0;
  let from = null;
  let to = null;

  editor.state.doc.descendants((node, pos) => {
    if (from !== null && to !== null) return false;
    if (node.isText) {
      const longitud = node.text.length;
      const inicioNodo = acumulado;
      const finNodo = acumulado + longitud;
      if (from === null && desde >= inicioNodo && desde < finNodo) {
        from = pos + (desde - inicioNodo);
      }
      if (to === null && hasta > inicioNodo && hasta <= finNodo) {
        to = pos + (hasta - inicioNodo);
      }
      acumulado += longitud;
    } else if (node.isBlock && acumulado > 0) {
      acumulado += 2;
    }
    return true;
  });

  return { from, to };
}

function buscarFragmentoTolerante(textoPlano, fragmento) {
  if (!fragmento) return -1;

  let idx = textoPlano.indexOf(fragmento);
  if (idx !== -1) return idx;

  const fragmentoNormalizado = fragmento.replace(/\s+/g, ' ').trim();
  const textoColapsado = textoPlano.replace(/\s+/g, ' ');
  const idxColapsado = textoColapsado.indexOf(fragmentoNormalizado);
  if (idxColapsado === -1) return -1;

  let posReal = 0;
  let posColapsada = 0;
  while (posColapsada < idxColapsado && posReal < textoPlano.length) {
    if (/\s/.test(textoPlano[posReal])) {
      while (posReal < textoPlano.length && /\s/.test(textoPlano[posReal])) posReal++;
      posColapsada++;
    } else {
      posReal++;
      posColapsada++;
    }
  }
  return posReal;
}

function aplicarMarcas(editor, sugerencias) {
  if (!editor) return;
  editor.chain().selectAll().unsetMark('sugerencia').unsetMark('seccionInicio').run();
  const textoPlano = editor.getText();

  for (const sug of sugerencias) {
    if (sug.estado !== 'pendiente') continue;
    if (sug.tipo === 'marcador_seccion') continue;
    if (!sug.fragmento_original) continue;

    const idx = buscarFragmentoTolerante(textoPlano, sug.fragmento_original);
    if (idx === -1) continue;

    const { from, to } = mapearPosicionTexto(editor, idx, idx + sug.fragmento_original.length);
    if (from == null || to == null) continue;

    editor.chain().setTextSelection({ from, to }).setMark('sugerencia', { sugerenciaId: sug.id, tipo: sug.tipo }).run();
  }

  for (const sec of sugerencias) {
    if (sec.tipo !== 'marcador_seccion') continue;
    if (!sec.fragmento_original) continue;

    const idx = buscarFragmentoTolerante(textoPlano, sec.fragmento_original);
    if (idx === -1) continue;

    const primerasPalabras = sec.fragmento_original.split(/\s+/).slice(0, 2).join(' ');
    const { from, to } = mapearPosicionTexto(editor, idx, idx + primerasPalabras.length);
    if (from == null || to == null) continue;

    editor.chain().setTextSelection({ from, to }).setMark('seccionInicio', { seccionId: sec.id, titulo: sec.fragmento_nuevo }).run();
  }

  editor.commands.setTextSelection(0);
}

function scrollHastaMarcaEnTexto(sugerenciaId) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`mark[data-sugerencia-id="${sugerenciaId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('mark--destello');
      setTimeout(() => el.classList.remove('mark--destello'), 3500);
    }
  });
}

function extraerHtmlParaGuardar(editor) {
  const html = editor.getHTML();
  const div = document.createElement('div');
  div.innerHTML = html;

  div.querySelectorAll('mark[data-sugerencia-id]').forEach((mark) => {
    const span = document.createElement('span');
    span.innerHTML = mark.innerHTML;
    mark.replaceWith(span);
  });

  div.querySelectorAll('span[data-seccion-id]').forEach((span) => {
    const inner = document.createElement('span');
    inner.innerHTML = span.innerHTML;
    span.replaceWith(inner);
  });

  return div.innerHTML;
}

function textoAHtml(texto) {
  if (!texto) return '<p></p>';
  if (/<[a-z][\s\S]*>/i.test(texto)) return texto;
  return texto
    .split(/\n\n+/)
    .map((parrafo) => `<p>${escapeHtml(normalizarEspacios(parrafo))}</p>`)
    .join('');
}

function escapeHtml(texto) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────────
// Barra de herramientas — se exporta para poder renderizarla
// en el panel derecho (sticky junto a las notas)
// ─────────────────────────────────────────────────────────────

export function BarraFormato({ editor }) {
  const [tamanoActual, setTamanoActual] = useState('17px');

  useEffect(() => {
    if (!editor) return;
    const actualizar = () => {
      const attrs = editor.getAttributes('textStyle');
      setTamanoActual(attrs.fontSize || '17px');
    };
    editor.on('selectionUpdate', actualizar);
    editor.on('transaction', actualizar);
    return () => {
      editor.off('selectionUpdate', actualizar);
      editor.off('transaction', actualizar);
    };
  }, [editor]);

  if (!editor) return null;

  function aplicarTamano(px) {
    editor.chain().focus().setMark('textStyle', { fontSize: px }).run();
    setTamanoActual(px);
  }

  return (
    <div className="editor-toolbar">
      <span className="editor-toolbar__label">Formato</span>

      <button
        className={`editor-toolbar__btn ${editor.isActive('bold') ? 'editor-toolbar__btn--active' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
        title="Negrilla (Ctrl+B)"
      >
        <strong>B</strong>
      </button>

      <button
        className={`editor-toolbar__btn ${editor.isActive('italic') ? 'editor-toolbar__btn--active' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
        title="Cursiva (Ctrl+I)"
      >
        <em>I</em>
      </button>

      <div className="editor-toolbar__separator" />

      <select
        className="editor-toolbar__select"
        value={tamanoActual}
        onChange={(e) => aplicarTamano(e.target.value)}
        title="Tamaño de texto"
      >
        <option value="12px">12px</option>
        <option value="14px">14px</option>
        <option value="17px">Normal</option>
        <option value="18px">18px</option>
        <option value="20px">20px</option>
        <option value="24px">24px</option>
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Componente principal — ya NO incluye la barra de formato
// (se renderiza desde la página CapituloEditor.jsx en el panel derecho)
// ─────────────────────────────────────────────────────────────

export let editorInstance = null;

export default function CapituloEditor({ capitulo, sugerencias, sugerenciaActivaId, onSugerenciaClick, onTextoChange, onEditorReady }) {
  const autosaveTimeoutRef = useRef(null);
  const autosaveForzadoRef = useRef(null);
  const ultimoHtmlGuardadoRef = useRef(capitulo.texto_actual || '');
  const editorRef = useRef(null);

  function guardarTexto(editorInstance) {
    if (!editorInstance || editorInstance.isDestroyed) return;
    const html = extraerHtmlParaGuardar(editorInstance);
    actualizarTextoCapitulo(capitulo.id, html)
      .then(() => {
        ultimoHtmlGuardadoRef.current = html;
        onTextoChange?.(editorInstance.getText());
      })
      .catch((err) => console.error('Error en autosave:', err));
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ bold: false, italic: false }),
      Bold,
      Italic,
      TextStyle,
      FontSize,
      SugerenciaMark,
      SeccionMark,
    ],
    content: textoAHtml(capitulo.texto_actual || ''),
    onUpdate: ({ editor: ed }) => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = setTimeout(() => guardarTexto(ed), AUTOSAVE_DEBOUNCE_MS);
    },
  });

  // Exponer el editor al componente padre para que pueda pasarlo a BarraFormato
  useEffect(() => {
    if (editor) {
      editorRef.current = editor;
      onEditorReady?.(editor);
    }
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor) return;
    autosaveForzadoRef.current = setInterval(() => guardarTexto(editorRef.current), AUTOSAVE_FORZADO_MS);
    return () => clearInterval(autosaveForzadoRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const nuevoHtml = textoAHtml(capitulo.texto_actual || '');
    if (capitulo.texto_actual !== ultimoHtmlGuardadoRef.current) {
      editor.commands.setContent(nuevoHtml);
      ultimoHtmlGuardadoRef.current = capitulo.texto_actual || '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capitulo.texto_actual, editor]);

  useEffect(() => {
    if (!editor) return;
    aplicarMarcas(editor, sugerencias);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, sugerencias, capitulo.texto_actual]);

  useEffect(() => {
    if (!editor) return;
    const handleClick = (event) => {
      const targetSug = event.target.closest('mark[data-sugerencia-id]');
      if (targetSug) {
        const id = targetSug.getAttribute('data-sugerencia-id');
        onSugerenciaClick?.(id);
      }
    };
    const dom = editor.view.dom;
    dom.addEventListener('click', handleClick);
    return () => dom.removeEventListener('click', handleClick);
  }, [editor, onSugerenciaClick]);

  useEffect(() => {
    if (!sugerenciaActivaId) return;
    scrollHastaMarcaEnTexto(sugerenciaActivaId);
  }, [sugerenciaActivaId]);

  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
      if (autosaveForzadoRef.current) clearInterval(autosaveForzadoRef.current);
    };
  }, []);

  return (
    <div className="manuscript-page">
      <EditorContent editor={editor} />
    </div>
  );
}