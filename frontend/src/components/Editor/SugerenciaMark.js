import { Mark } from '@tiptap/core';

export const SugerenciaMark = Mark.create({
  name: 'sugerencia',

  addAttributes() {
    return {
      sugerenciaId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-sugerencia-id'),
        renderHTML: (attributes) => {
          if (!attributes.sugerenciaId) return {};
          return { 'data-sugerencia-id': attributes.sugerenciaId };
        },
      },
      tipo: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-tipo'),
        renderHTML: (attributes) => {
          if (!attributes.tipo) return {};
          return { 'data-tipo': attributes.tipo };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-sugerencia-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', { ...HTMLAttributes, style: 'background-color: #F3E6C8; border-bottom: 2px solid #C9A35C; border-radius: 2px;' }, 0];
  },
});

/**
 * Nodo decorativo (no-mark) para marcar el INICIO de una sección del
 * sermón. Se inserta como un pequeño elemento de tipo "etiqueta" antes
 * del párrafo correspondiente, sin resaltar el texto.
 */
export const SeccionMark = Mark.create({
  name: 'seccionInicio',

  addAttributes() {
    return {
      seccionId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-seccion-id'),
        renderHTML: (attributes) => {
          if (!attributes.seccionId) return {};
          return { 'data-seccion-id': attributes.seccionId };
        },
      },
      titulo: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-titulo'),
        renderHTML: (attributes) => {
          if (!attributes.titulo) return {};
          return { 'data-titulo': attributes.titulo, title: attributes.titulo };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-seccion-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      {
        ...HTMLAttributes,
        style:
          'display: inline-block; border-left: 3px solid #3F5D4F; padding-left: 6px; margin-right: 2px;',
      },
      0,
    ];
  },
});