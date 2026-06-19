import { useEffect, useRef, useState } from 'react';
import { obtenerEstadoTrabajo } from '../services/api';

const INTERVALO_MS = 4000;

/**
 * Hace polling del estado de un trabajo de la cola (instrucción manual)
 * hasta que quede 'completado' o 'fallido'.
 *
 * @param {string} capituloId
 * @param {string|null} trabajoId
 * @param {() => void} onCompletado
 */
export function usePollingTrabajo(capituloId, trabajoId, onCompletado) {
  const [estado, setEstado] = useState(null);
  const intervaloRef = useRef(null);

  useEffect(() => {
    if (!trabajoId) {
      setEstado(null);
      return;
    }

    setEstado('pendiente');

    intervaloRef.current = setInterval(async () => {
      try {
        const trabajo = await obtenerEstadoTrabajo(capituloId, trabajoId);
        setEstado(trabajo.estado);

        if (trabajo.estado === 'completado') {
          clearInterval(intervaloRef.current);
          onCompletado?.();
        } else if (trabajo.estado === 'fallido') {
          clearInterval(intervaloRef.current);
        }
      } catch (err) {
        console.error('Error en polling de trabajo:', err);
      }
    }, INTERVALO_MS);

    return () => clearInterval(intervaloRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capituloId, trabajoId]);

  return estado;
}