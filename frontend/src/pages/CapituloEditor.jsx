import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  obtenerCapitulo,
  listarSugerencias,
  actualizarMetadatosCapitulo,
  eliminarCapitulo,
  promoverCapitulo,
  despromoverCapitulo,
} from '../services/api';
import { usePollingEstado } from '../hooks/usePollingEstado';
import CapituloEditorComponent, { BarraFormato } from '../components/Editor/CapituloEditor';
import SugerenciasPanel from '../components/SugerenciasPanel/SugerenciasPanel';

const ETIQUETAS_ESTADO = {
  pendiente: 'Pendiente',
  transcribiendo: 'Transcribiendo audio',
  analizando: 'Analizando con IA',
  listo: 'Listo',
  error: 'Error',
};

const ICONOS_ESTADO = {
  pendiente: '○',
  transcribiendo: '♪',
  analizando: '✦',
  listo: '✓',
  error: '!',
};

export default function CapituloEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [capitulo, setCapitulo] = useState(null);
  const [sugerencias, setSugerencias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [sugerenciaActivaId, setSugerenciaActivaId] = useState(null);
  const [editorActivo, setEditorActivo] = useState(null);

  const [titulo, setTitulo] = useState('');
  const [fecha, setFecha] = useState('');
  const [editando, setEditando] = useState(false);
  const [guardandoMeta, setGuardandoMeta] = useState(false);

  const [promoviendo, setPromoviendo] = useState(false);
  const [mensajePromover, setMensajePromover] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);

  const { estado, errorDetalle } = usePollingEstado(id, capitulo?.estado);

  async function cargarDatos() {
    try {
      setCargando(true);
      const cap = await obtenerCapitulo(id);
      setCapitulo(cap);
      setTitulo(cap.titulo || '');
      setFecha(cap.fecha_sermon || '');

      if (cap.estado === 'listo' || cap.estado === 'analizando') {
        const sugs = await listarSugerencias(id);
        setSugerencias(sugs);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargarDatos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (estado === 'listo' && capitulo?.estado !== 'listo') {
      cargarDatos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  async function handleGuardarMetadatos() {
    if (!titulo.trim() || !fecha.trim()) return;
    try {
      setGuardandoMeta(true);
      await actualizarMetadatosCapitulo(id, { titulo, fecha_sermon: fecha });
      setEditando(false);
      await cargarDatos();
    } catch (err) {
      console.error(err);
    } finally {
      setGuardandoMeta(false);
    }
  }

  async function handlePromover() {
    try {
      setPromoviendo(true);
      await promoverCapitulo(id);
      setMensajePromover('Capítulo agregado/actualizado en el libro.');
      await cargarDatos();
    } catch (err) {
      console.error(err);
      setMensajePromover(err.response?.data?.error || 'Error al agregar al libro');
    } finally {
      setPromoviendo(false);
    }
  }

  async function handleQuitarDelLibro() {
    try {
      setPromoviendo(true);
      await despromoverCapitulo(id);
      setMensajePromover('Capítulo quitado del libro.');
      await cargarDatos();
    } catch (err) {
      console.error(err);
      setMensajePromover('Error al quitar el capítulo del libro');
    } finally {
      setPromoviendo(false);
    }
  }

  async function handleEliminarCapitulo() {
    try {
      setEliminando(true);
      await eliminarCapitulo(id);
      navigate('/');
    } catch (err) {
      console.error(err);
      setEliminando(false);
    }
  }

  async function handleSugerenciasActualizadas() {
    const sugs = await listarSugerencias(id);
    setSugerencias(sugs);
    const cap = await obtenerCapitulo(id);
    setCapitulo(cap);
  }

  function handleSeleccionarSugerencia(idSug) {
    setSugerenciaActivaId(idSug);
  }

  if (cargando && !capitulo) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-state__icon">···</span>
          <p className="empty-state__text">Cargando capítulo...</p>
        </div>
      </div>
    );
  }

  if (!capitulo) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-state__icon">?</span>
          <p className="empty-state__text">Capítulo no encontrado.</p>
        </div>
        <Link to="/" className="btn btn--outline-light">← Volver</Link>
      </div>
    );
  }

  const enProceso = estado === 'transcribiendo' || estado === 'pendiente';
  const analizando = estado === 'analizando';

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <Link to="/" className="btn btn--outline-light btn--small">
          ← Volver a capítulos
        </Link>

        <div style={{ display: 'flex', gap: 8 }}>
          {!confirmandoEliminar ? (
            <button className="btn btn--outline-light btn--small" onClick={() => setConfirmandoEliminar(true)}>
              Eliminar capítulo
            </button>
          ) : (
            <>
              <span style={{ color: 'var(--gold-bright)', fontFamily: 'var(--font-mono)', fontSize: 12, alignSelf: 'center' }}>
                ¿Eliminar permanentemente?
              </span>
              <button className="btn btn--outline-light btn--small" onClick={() => setConfirmandoEliminar(false)} disabled={eliminando}>
                Cancelar
              </button>
              <button className="btn btn--primary btn--small" onClick={handleEliminarCapitulo} disabled={eliminando}>
                {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <span className="panel__ribbon"></span>

        <div className="chapter-header">
          {editando ? (
            <>
              <div className="field">
                <label className="field__label">Título del capítulo</label>
                <input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
              </div>
              <div className="field" style={{ flex: '0 0 180px' }}>
                <label className="field__label">Fecha del sermón</label>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>
            </>
          ) : (
            <div>
              <h2 className="section-header__title" style={{ fontSize: 22 }}>
                {capitulo.titulo || `Sermón del ${capitulo.fecha_sermon}`}
              </h2>
              <p className="chapter-meta" style={{ marginTop: 6 }}>Fecha del sermón: {capitulo.fecha_sermon}</p>
            </div>
          )}

          <div className="seal-group">
            <span className={`seal seal--${estado}`}>{ICONOS_ESTADO[estado] || '?'}</span>
            <span className="seal-label">{ETIQUETAS_ESTADO[estado] || estado}</span>
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {editando ? (
            <>
              <button className="btn btn--primary" onClick={handleGuardarMetadatos} disabled={guardandoMeta}>
                {guardandoMeta ? 'Guardando...' : 'Guardar cambios'}
              </button>
              <button className="btn btn--ghost" onClick={() => { setEditando(false); setTitulo(capitulo.titulo || ''); setFecha(capitulo.fecha_sermon || ''); }}>
                Cancelar
              </button>
            </>
          ) : (
            <button className="btn btn--ghost" onClick={() => setEditando(true)}>
              Editar título / fecha
            </button>
          )}

          <button
            className="btn btn--primary"
            onClick={handlePromover}
            disabled={promoviendo || !capitulo.texto_actual}
          >
            {promoviendo ? 'Procesando...' : capitulo.promovido ? 'Actualizar en el libro' : 'Subir al libro'}
          </button>

          {capitulo.promovido && (
            <button className="btn btn--ghost" onClick={handleQuitarDelLibro} disabled={promoviendo}>
              Quitar del libro
            </button>
          )}
        </div>

        {errorDetalle && (
          <p style={{ color: 'var(--rust)', fontSize: 13, marginTop: 10 }}>Error: {errorDetalle}</p>
        )}

        {mensajePromover && (
          <p style={{ fontSize: 13, color: 'var(--forest)', marginTop: 10 }}>{mensajePromover}</p>
        )}
      </div>

      {enProceso && (
        <div className="panel">
          <span className="panel__ribbon panel__ribbon--slate"></span>
          <p><span className="spinner"></span>Transcribiendo el audio... esto puede tardar varios minutos dependiendo de la duración del sermón.</p>
        </div>
      )}

      {!enProceso && !capitulo.texto_actual && (
        <div className="panel">
          <div className="empty-state">
            <span className="empty-state__icon">···</span>
            <p className="empty-state__text">Aún no hay texto disponible para este capítulo.</p>
          </div>
        </div>
      )}

      {capitulo.texto_actual && (
        <div className="editor-layout">
          <CapituloEditorComponent
            capitulo={capitulo}
            sugerencias={sugerencias}
            sugerenciaActivaId={sugerenciaActivaId}
            onSugerenciaClick={handleSeleccionarSugerencia}
            onTextoChange={() => {}}
            onEditorReady={setEditorActivo}
          />

          <div>
            <BarraFormato editor={editorActivo} />

            {analizando && (
              <div className="panel">
                <span className="panel__ribbon panel__ribbon--slate"></span>
                <p><span className="spinner"></span>Analizando el texto con IA...</p>
              </div>
            )}
            <SugerenciasPanel
              capituloId={id}
              sugerencias={sugerencias}
              sugerenciaActivaId={sugerenciaActivaId}
              onSugerenciaClick={handleSeleccionarSugerencia}
              onLimpiarActiva={() => setSugerenciaActivaId(null)}
              onSugerenciasActualizadas={handleSugerenciasActualizadas}
            />
          </div>
        </div>
      )}
    </div>
  );
}