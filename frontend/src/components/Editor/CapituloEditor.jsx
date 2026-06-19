import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { SugerenciaMark, SeccionMark } from './SugerenciaMark';
import { actualizarTextoCapitulo } from '../../services/api';

const AUTOSAVE_DEBOUNCE_MS = 3000;
const AUTOSAVE_FORZADO_MS = 30000;

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

function aplicarMarcas(editor, sugerencias) {
  if (!editor) return;

  editor.chain().selectAll().unsetMark('sugerencia').unsetMark('seccionInicio').run();

  const textoPlano = editor.getText();

  // 1. Resaltados de sugerencias pendientes
  for (const sug of sugerencias) {
    if (sug.estado !== 'pendiente') continue;
    if (sug.tipo === 'marcador_seccion') continue;
    if (!sug.fragmento_original) continue;

    const idx = textoPlano.indexOf(sug.fragmento_original);
    if (idx === -1) continue;

    const { from, to } = mapearPosicionTexto(editor, idx, idx + sug.fragmento_original.length);
    if (from == null || to == null) continue;

    editor
      .chain()
      .setTextSelection({ from, to })
      .setMark('sugerencia', { sugerenciaId: sug.id, tipo: sug.tipo })
      .run();
  }

  // 2. Marcadores de sección (solo marca las primeras 2 palabras)
  for (const sec of sugerencias) {
    if (sec.tipo !== 'marcador_seccion') continue;
    if (!sec.fragmento_original) continue;

    const idx = textoPlano.indexOf(sec.fragmento_original);
    if (idx === -1) continue;

    const primerasPalabras = sec.fragmento_original.split(/\s+/).slice(0, 2).join(' ');
    const { from, to } = mapearPosicionTexto(editor, idx, idx + primerasPalabras.length);
    if (from == null || to == null) continue;

    editor
      .chain()
      .setTextSelection({ from, to })
      .setMark('seccionInicio', { seccionId: sec.id, titulo: sec.fragmento_nuevo })
      .run();
  }

  editor.commands.setTextSelection(0);
}

export default function CapituloEditor({ capitulo, sugerencias, onSugerenciaClick, onTextoChange }) {
  const autosaveTimeoutRef = useRef(null);
  const autosaveForzadoRef = useRef(null);
  const ultimoTextoCargadoRef = useRef(capitulo.texto_actual || '');
  const editorRef = useRef(null);

  function guardarTexto(editorInstance) {
    if (!editorInstance || editorInstance.isDestroyed) return;
    const texto = editorInstance.getText();
    actualizarTextoCapitulo(capitulo.id, texto)
      .then(() => {
        ultimoTextoCargadoRef.current = texto;
      })
      .catch((err) => console.error('Error en autosave:', err));
  }

  const editor = useEditor({
    extensions: [StarterKit, SugerenciaMark, SeccionMark],
    content: textoAHtml(capitulo.texto_actual || ''),
    onUpdate: ({ editor: ed }) => {
      const texto = ed.getText();
      onTextoChange?.(texto);

      // Debounce: guarda 3s después de dejar de escribir
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = setTimeout(() => {
        guardarTexto(ed);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
  });

  // Guardar referencia del editor para el autosave forzado
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Autosave forzado cada 30 segundos
  useEffect(() => {
    if (!editor) return;

    autosaveForzadoRef.current = setInterval(() => {
      guardarTexto(editorRef.current);
    }, AUTOSAVE_FORZADO_MS);

    return () => clearInterval(autosaveForzadoRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Recargar contenido si el texto cambió externamente (ej. tras aplicar sugerencias)
  // pero NO pisar ediciones manuales que aún no se guardaron
  useEffect(() => {
    if (!editor) return;
    const nuevoTexto = capitulo.texto_actual || '';

    if (nuevoTexto !== ultimoTextoCargadoRef.current) {
      editor.commands.setContent(textoAHtml(nuevoTexto));
      ultimoTextoCargadoRef.current = nuevoTexto;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capitulo.texto_actual, editor]);

  // Aplicar marcas cuando cambian las sugerencias
  useEffect(() => {
    if (!editor) return;
    aplicarMarcas(editor, sugerencias);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, sugerencias, capitulo.texto_actual]);

  // Clic en fragmento resaltado → filtrar panel a esa sugerencia
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

  // Cleanup al desmontar
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

function textoAHtml(texto) {
  if (!texto) return '<p></p>';
  return texto
    .split(/\n\n+/)
    .map((parrafo) => `<p>${escapeHtml(parrafo.trim())}</p>`)
    .join('');
}

function escapeHtml(texto) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}