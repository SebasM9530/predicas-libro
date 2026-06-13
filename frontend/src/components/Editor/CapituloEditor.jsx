import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { SugerenciaMark } from './SugerenciaMark';
import { actualizarTextoCapitulo } from '../../services/api';

const AUTOSAVE_INTERVALO_MS = 8000;

/**
 * Aplica los marks de resaltado sobre el documento del editor,
 * buscando cada `fragmento_original` de las sugerencias pendientes
 * dentro del texto plano.
 */
function resaltarSugerencias(editor, sugerencias) {
  if (!editor) return;

  // Quitar resaltados previos
  editor.chain().selectAll().unsetMark('sugerencia').run();

  const textoPlano = editor.getText();

  for (const sug of sugerencias) {
    if (sug.estado !== 'pendiente') continue;
    if (!sug.fragmento_original) continue;

    const idx = textoPlano.indexOf(sug.fragmento_original);
    if (idx === -1) continue;

    const desde = idx;
    const hasta = idx + sug.fragmento_original.length;

    // Convertir posiciones de texto plano a posiciones del documento ProseMirror.
    // Tiptap usa posiciones basadas en nodos; para texto simple (un solo
    // párrafo de bloques), sumamos 1 por cada salto de párrafo recorrido.
    const { from, to } = mapearPosicionTexto(editor, desde, hasta);

    if (from == null || to == null) continue;

    editor
      .chain()
      .setTextSelection({ from, to })
      .setMark('sugerencia', { sugerenciaId: sug.id, tipo: sug.tipo })
      .run();
  }

  // Deseleccionar al terminar
  editor.commands.setTextSelection(0);
}

/**
 * Mapea un rango [desde, hasta) de texto plano (getText()) a posiciones
 * del documento ProseMirror, recorriendo los nodos de texto del doc.
 */
function mapearPosicionTexto(editor, desde, hasta) {
  let acumulado = 0;
  let from = null;
  let to = null;

  editor.state.doc.descendants((node, pos) => {
    if (from !== null && to !== null) return false; // ya encontramos ambos

    if (node.isText) {
      const longitud = node.text.length;
      const inicioNodo = acumulado;
      const finNodo = acumulado + longitud;

      if (from === null && desde >= inicioNodo && desde < finNodo) {
        from = pos + (desde - inicioNodo);
      }
      if (from === null && desde === finNodo) {
        // el rango empieza justo donde termina este nodo; se resolverá en el siguiente
      }

      if (to === null && hasta > inicioNodo && hasta <= finNodo) {
        to = pos + (hasta - inicioNodo);
      }

      acumulado += longitud;
    } else if (node.isBlock && acumulado > 0) {
      // Tiptap getText() separa bloques con "\n\n" por defecto
      acumulado += 2;
    }

    return true;
  });

  return { from, to };
}

export default function CapituloEditor({ capitulo, sugerencias, onSugerenciaClick, onTextoChange }) {
  const autosaveTimeoutRef = useRef(null);

  const editor = useEditor({
    extensions: [StarterKit, SugerenciaMark],
    content: textoAHtml(capitulo.texto_actual || ''),
    onUpdate: ({ editor }) => {
      const texto = editor.getText();
      onTextoChange?.(texto);

      // Autosave con debounce
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = setTimeout(() => {
        actualizarTextoCapitulo(capitulo.id, texto).catch((err) =>
          console.error('Error en autosave:', err)
        );
      }, AUTOSAVE_INTERVALO_MS);
    },
  });

  // Aplicar resaltados cuando cambian las sugerencias o el editor está listo
  useEffect(() => {
    if (!editor) return;
    resaltarSugerencias(editor, sugerencias);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, sugerencias]);

  // Manejar clic en un fragmento resaltado
  useEffect(() => {
    if (!editor) return;

    const handleClick = (event) => {
      const target = event.target.closest('mark[data-sugerencia-id]');
      if (target) {
        const id = target.getAttribute('data-sugerencia-id');
        onSugerenciaClick?.(id);
      }
    };

    const dom = editor.view.dom;
    dom.addEventListener('click', handleClick);
    return () => dom.removeEventListener('click', handleClick);
  }, [editor, onSugerenciaClick]);

  // Limpiar timeout de autosave al desmontar
  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    };
  }, []);

  return (
    <div className="editor-area">
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * Convierte texto plano a HTML simple, separando párrafos por saltos de línea dobles.
 */
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
