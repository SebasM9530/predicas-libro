import { useState } from 'react';
import { aplicarSugerencias, rechazarSugerencia, enviarInstruccion } from '../../services/api';

const ETIQUETAS_TIPO = {
  mejorar_redaccion: 'Mejorar redacción',
  eliminar_muletilla: 'Eliminar muletilla',
  eliminar_redundancia: 'Eliminar redundancia',
  ampliar: 'Ampliar idea',
  eliminar_opinion_personal: 'Opinión personal',
  corregir_transcripcion: 'Corrección de transcripción',
  mejorar_transicion: 'Mejorar transición',
};

export default function SugerenciasPanel({
  capituloId,
  sugerencias,
  sugerenciaActivaId,
  onSugerenciasActualizadas,
}) {
  const [seleccionadas, setSeleccionadas] = useState(new Set());
  const [aplicando, setAplicando] = useState(false);
  const [instruccion, setInstruccion] = useState('');
  const [enviandoInstruccion, setEnviandoInstruccion] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const pendientes = sugerencias.filter((s) => s.estado === 'pendiente');

  function toggleSeleccion(id) {
    setSeleccionadas((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  async function handleAplicar() {
    if (seleccionadas.size === 0) return;

    try {
      setAplicando(true);
      await aplicarSugerencias(capituloId, Array.from(seleccionadas));
      setSeleccionadas(new Set());
      setMensaje('Cambios aplicados correctamente. Recarga la página para ver el texto actualizado.');
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
      await enviarInstruccion(capituloId, instruccion);
      setInstruccion('');
      setMensaje('Instrucción enviada. Las nuevas sugerencias aparecerán en unos momentos (puede tardar 1-2 minutos).');
    } catch (err) {
      console.error(err);
      setMensaje('Error al enviar la instrucción');
    } finally {
      setEnviandoInstruccion(false);
    }
  }

  return (
    <div className="panel-sugerencias">
      <h3>Sugerencias ({pendientes.length})</h3>

      {mensaje && (
        <p style={{ fontSize: 13, color: '#1d4ed8', background: '#eff6ff', padding: 8, borderRadius: 6 }}>
          {mensaje}
        </p>
      )}

      {pendientes.length === 0 && <p>No hay sugerencias pendientes.</p>}

      {pendientes.map((sug) => (
        <div
          key={sug.id}
          className={`sugerencia-item ${sug.id === sugerenciaActivaId ? 'activa' : ''}`}
          id={`sugerencia-${sug.id}`}
        >
          <div className="sugerencia-tipo">{ETIQUETAS_TIPO[sug.tipo] || sug.tipo}</div>
          <div className="sugerencia-texto-original">{truncar(sug.fragmento_original, 120)}</div>
          <div className="sugerencia-texto-nuevo">
            {sug.fragmento_nuevo ? truncar(sug.fragmento_nuevo, 120) : '(eliminar)'}
          </div>
          <div className="sugerencia-problema">{sug.problema}</div>

          {sug.nota_adicional && (
            <div className="sugerencia-nota">⚠ {sug.nota_adicional}</div>
          )}

          <div className="checkbox-aplicar">
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
            className="boton boton-secundario boton-pequeno"
            style={{ marginTop: 6 }}
            onClick={() => handleRechazar(sug.id)}
          >
            Descartar sugerencia
          </button>
        </div>
      ))}

      {pendientes.length > 0 && (
        <div className="barra-acciones">
          <button className="boton" onClick={handleAplicar} disabled={aplicando || seleccionadas.size === 0}>
            {aplicando ? 'Aplicando...' : `Aplicar cambios seleccionados (${seleccionadas.size})`}
          </button>
        </div>
      )}

      <div className="instrucciones-box">
        <h4>Instrucciones generales</h4>
        <p style={{ fontSize: 12, color: '#6b7280' }}>
          Ej. "Elimina todas las partes donde doy una opinión personal" o "Resume las introducciones largas".
        </p>
        <form onSubmit={handleEnviarInstruccion}>
          <textarea
            value={instruccion}
            onChange={(e) => setInstruccion(e.target.value)}
            placeholder="Escribe una instrucción para generar nuevas sugerencias..."
          />
          <button className="boton" type="submit" disabled={enviandoInstruccion || !instruccion.trim()} style={{ marginTop: 8 }}>
            {enviandoInstruccion ? 'Enviando...' : 'Generar sugerencias'}
          </button>
        </form>
      </div>
    </div>
  );
}

function truncar(texto, max) {
  if (!texto) return '';
  return texto.length > max ? texto.slice(0, max) + '...' : texto;
}
