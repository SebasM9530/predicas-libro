import { Mark } from '@tiptap/core';

/**
 * Mark personalizado de Tiptap para resaltar fragmentos que tienen
 * una sugerencia asociada. Guarda el id de la sugerencia como atributo
 * para poder identificarla al hacer clic.
 */
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
    return ['mark', { ...HTMLAttributes, style: 'background-color: #fef08a;' }, 0];
  },
});
