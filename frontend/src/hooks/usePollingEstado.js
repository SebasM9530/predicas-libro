import { useEffect, useRef, useState } from 'react';
import { obtenerEstadoCapitulo } from '../services/api';

const ESTADOS_FINALES = ['listo', 'error'];
const INTERVALO_MS = 5000;

/**
 * Hace polling del estado de un capítulo mientras esté en
 * 'pendiente', 'transcribiendo' o 'analizando'.
 * Se detiene automáticamente al llegar a 'listo' o 'error'.
 *
 * @param {string} capituloId
 * @param {string} estadoInicial
 */
export function usePollingEstado(capituloId, estadoInicial) {
  const [estado, setEstado] = useState(estadoInicial);
  const [errorDetalle, setErrorDetalle] = useState(null);
  const intervaloRef = useRef(null);

  useEffect(() => {
    if (!capituloId) return;
    if (ESTADOS_FINALES.includes(estado)) return;

    intervaloRef.current = setInterval(async () => {
      try {
        const capitulo = await obtenerEstadoCapitulo(capituloId);
        setEstado(capitulo.estado);
        setErrorDetalle(capitulo.error_detalle || null);

        if (ESTADOS_FINALES.includes(capitulo.estado)) {
          clearInterval(intervaloRef.current);
        }
      } catch (err) {
        console.error('Error en polling de estado:', err);
      }
    }, INTERVALO_MS);

    return () => clearInterval(intervaloRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capituloId, estado]);

  return { estado, errorDetalle };
}
