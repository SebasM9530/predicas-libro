import { useState } from 'react';
import { aplicarSugerencias, rechazarSugerencia, enviarInstruccion } from '../../services/api';
import { usePollingTrabajo } from '../../hooks/usePollingTrabajo';

const ETIQUETAS_TIPO = {
  mejorar_redaccion: 'Mejorar redacción',
  eliminar_muletilla: 'Eliminar muletilla',
  eliminar_redundancia: 'Eliminar redundancia',
  ampliar: 'Ampliar idea',
  eliminar_opinion_personal: 'Opinión personal',
  corregir_transcripcion: 'Corrección',
  mejorar_transicion: 'Mejorar transición',
};

export default function SugerenciasPanel({
  capituloId,
  sugerencias,
  sugerenciaActivaId,
  onSugerenciaClick,
  onLimpiarActiva,
  onSugerenciasActualizadas,
}) {
  const [seleccionadas, setSeleccionadas] = useState(new Set());
  const [aplicando, setAplicando] = useState(false);
  const [instruccion, setInstruccion] = useState('');
  const [enviandoInstruccion, setEnviandoInstruccion] = useState(false);
  const [trabajoId, setTrabajoId] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  const estadoTrabajo = usePollingTrabajo(capituloId, trabajoId, async () => {
    setMensaje('Nuevas notas generadas.');
    setTrabajoId(null);
    await onSugerenciasActualizadas?.();
  });

  const pendientes = sugerencias.filter((s) => s.estado === 'pendiente' && s.tipo !== 'marcador_seccion');
  const automaticas = pendientes.filter((s) => s.origen === 'automatico');

  // Filtrar sugerencias de instrucción manual que ya están cubiertas por
  // una sugerencia automática pendiente con el mismo fragmento_original.
  // Así evitamos mostrar notas duplicadas cuando el pastor envía instrucciones.
  const fragmentosAutomaticos = new Set(
    automaticas.map((s) => s.fragmento_original?.trim()).filter(Boolean)
  );
  const especificas = pendientes.filter(
    (s) =>
      s.origen === 'instruccion_manual' &&
      !fragmentosAutomaticos.has(s.fragmento_original?.trim())
  );

  const sugerenciaActiva = sugerenciaActivaId
    ? pendientes.find((s) => s.id === sugerenciaActivaId)
    : null;

  function toggleSeleccion(id) {
    setSeleccionadas((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  function toggleSeleccionarTodas() {
    const todasIds = pendientes.map((s) => s.id);
    const todasSeleccionadas = todasIds.every((id) => seleccionadas.has(id));
    if (todasSeleccionadas) {
      setSeleccionadas(new Set());
    } else {
      setSeleccionadas(new Set(todasIds));
    }
  }

  async function handleAplicar() {
    if (seleccionadas.size === 0) return;
    try {
      setAplicando(true);
      await aplicarSugerencias(capituloId, Array.from(seleccionadas));
      setSeleccionadas(new Set());
      setMensaje('Cambios aplicados al manuscrito.');
      onLimpiarActiva?.();
      await onSugerenciasActualizadas?.();
    } catch (err) {
      console.error(err);
      setMensaje('Error al aplicar los cambios seleccionados');
    } finally {
      setAplicando(false);
    }
  }

  async function handleRechazar(id) {
    try {
      await rechazarSugerencia(id);
      if (id === sugerenciaActivaId) onLimpiarActiva?.();
      await onSugerenciasActualizadas?.();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleEnviarInstruccion(e) {
    e.preventDefault();
    if (!instruccion.trim()) return;
    try {
      setEnviandoInstruccion(true);
      setMensaje(null);
      const resultado = await enviarInstruccion(capituloId, instruccion);
      setInstruccion('');
      setTrabajoId(resultado.trabajo_id);
    } catch (err) {
      console.error(err);
      setMensaje('Error al enviar la instrucción');
    } finally {
      setEnviandoInstruccion(false);
    }
  }

  function handleClickNota(id) {
    onSugerenciaClick?.(id);
  }

  function renderNota(sug) {
    return (
      <div
        key={sug.id}
        className={`marginalia__note marginalia__note--${sug.tipo} ${
          sug.id === sugerenciaActivaId ? 'marginalia__note--activa' : ''
        }`}
        id={`sugerencia-${sug.id}`}
        onClick={() => handleClickNota(sug.id)}
        style={{ cursor: 'pointer' }}
      >
        <div className="marginalia__tag">{ETIQUETAS_TIPO[sug.tipo] || sug.tipo}</div>
        <div className="marginalia__original">{sug.fragmento_original}</div>
        <div className="marginalia__new">
          {sug.fragmento_nuevo ? sug.fragmento_nuevo : '(eliminar)'}
        </div>
        <div className="marginalia__problem">{sug.problema}</div>

        {sug.nota_adicional && (
          <div className="marginalia__alert">⚠ {sug.nota_adicional}</div>
        )}

        <div className="marginalia__check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={seleccionadas.has(sug.id)}
            onChange={() => toggleSeleccion(sug.id)}
            id={`check-${sug.id}`}
          />
          <label htmlFor={`check-${sug.id}`} style={{ margin: 0, fontWeight: 400 }}>
            Aplicar este cambio
          </label>
        </div>

        <button
          className="btn btn--ghost btn--small"
          style={{ marginTop: 8 }}
          onClick={(e) => {
            e.stopPropagation();
            handleRechazar(sug.id);
          }}
        >
          Descartar nota
        </button>
      </div>
    );
  }

  return (
    /*
     * marginalia-wrapper es sticky: se queda fijo mientras el pastor
     * hace scroll en el manuscrito. Usa flex column para dividir el
     * espacio entre el panel de notas (scroll interno) y el panel de
     * instrucciones (altura fija abajo).
     */
    <div className="marginalia-wrapper">

      {/* Panel de notas — ocupa el espacio disponible y hace scroll interno */}
      <div className="marginalia">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0 }}>
          <h3 className="marginalia__header" style={{ marginBottom: 0 }}>
            Notas al margen ({pendientes.length})
          </h3>
          {pendientes.length > 0 && !sugerenciaActiva && (
            <button
              className="btn btn--ghost btn--small"
              onClick={toggleSeleccionarTodas}
              style={{ fontSize: 11, padding: '3px 10px', whiteSpace: 'nowrap' }}
            >
              {pendientes.every((s) => seleccionadas.has(s.id)) ? 'Deseleccionar todo' : 'Seleccionar todo'}
            </button>
          )}
        </div>

        {mensaje && <p className="marginalia__notice">{mensaje}</p>}

        {sugerenciaActiva ? (
          <>
            <button
              className="btn btn--ghost btn--small"
              onClick={onLimpiarActiva}
              style={{ marginBottom: 12 }}
            >
              ← Ver todas las notas
            </button>
            {renderNota(sugerenciaActiva)}
          </>
        ) : (
          <>
            {pendientes.length === 0 && (
              <div className="empty-state">
                <span className="empty-state__icon" style={{ color: 'var(--gold-bright)' }}>···</span>
                <p className="empty-state__text" style={{ color: 'rgba(248,237,214,0.7)' }}>
                  No hay notas pendientes.
                </p>
              </div>
            )}

            {automaticas.length > 0 && (
              <>
                <div className="marginalia__group-title">Recomendaciones IA</div>
                {automaticas.map(renderNota)}
              </>
            )}

            {especificas.length > 0 && (
              <>
                <div className="marginalia__group-title">Recomendaciones específicas IA</div>
                {especificas.map(renderNota)}
              </>
            )}
          </>
        )}

        {pendientes.length > 0 && !sugerenciaActiva && (
          <div className="marginalia__apply-bar">
            <button
              className="btn btn--primary"
              onClick={handleAplicar}
              disabled={aplicando || seleccionadas.size === 0}
            >
              {aplicando ? 'Aplicando...' : `Aplicar seleccionados (${seleccionadas.size})`}
            </button>
          </div>
        )}
      </div>

      {/* Panel de instrucciones — altura fija, siempre visible abajo */}
      <div className="marginalia marginalia--instrucciones">
        <h4 className="marginalia__instructions-title">Instrucciones generales</h4>
        <p className="marginalia__instructions-hint">
          Ej. "Elimina las partes donde doy una opinión personal" o "resume las introducciones largas".
        </p>
        <form onSubmit={handleEnviarInstruccion}>
          <div className="field">
            <textarea
              value={instruccion}
              onChange={(e) => setInstruccion(e.target.value)}
              placeholder="Escribe una instrucción para generar nuevas notas..."
              disabled={!!trabajoId}
            />
          </div>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={enviandoInstruccion || !!trabajoId || !instruccion.trim()}
          >
            {enviandoInstruccion ? 'Enviando...' : 'Generar notas'}
          </button>
        </form>

        {trabajoId && (
          <div className="progress">
            <div className="progress__track">
              <div className="progress__fill progress__fill--indeterminado"></div>
            </div>
            <p className="progress__label">
              {estadoTrabajo === 'fallido'
                ? 'La IA no pudo procesar la instrucción. Intenta de nuevo.'
                : 'La IA está analizando tu instrucción...'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}