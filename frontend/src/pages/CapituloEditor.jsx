import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  obtenerCapitulo,
  listarSugerencias,
  actualizarTituloCapitulo,
  promoverCapitulo,
} from '../services/api';
import { usePollingEstado } from '../hooks/usePollingEstado';
import CapituloEditorComponent from '../components/Editor/CapituloEditor';
import SugerenciasPanel from '../components/SugerenciasPanel/SugerenciasPanel';

const ETIQUETAS_ESTADO = {
  pendiente: 'Pendiente',
  transcribiendo: 'Transcribiendo audio...',
  analizando: 'Analizando con IA...',
  listo: 'Listo',
  error: 'Error',
};

export default function CapituloEditorPage() {
  const { id } = useParams();
  const [capitulo, setCapitulo] = useState(null);
  const [sugerencias, setSugerencias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [sugerenciaActivaId, setSugerenciaActivaId] = useState(null);
  const [titulo, setTitulo] = useState('');
  const [promoviendo, setPromoviendo] = useState(false);
  const [mensajePromover, setMensajePromover] = useState(null);

  const { estado, errorDetalle } = usePollingEstado(id, capitulo?.estado);

  async function cargarDatos() {
    try {
      setCargando(true);
      const cap = await obtenerCapitulo(id);
      setCapitulo(cap);
      setTitulo(cap.titulo || '');

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

  // Cuando el polling detecta que pasó a "listo", recargar capítulo y sugerencias
  useEffect(() => {
    if (estado === 'listo' && capitulo?.estado !== 'listo') {
      cargarDatos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  async function handleGuardarTitulo() {
    if (!titulo.trim()) return;
    try {
      await actualizarTituloCapitulo(id, titulo);
    } catch (err) {
      console.error(err);
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

  async function handleSugerenciasActualizadas() {
    const sugs = await listarSugerencias(id);
    setSugerencias(sugs);

    const cap = await obtenerCapitulo(id);
    setCapitulo(cap);
  }

  if (cargando && !capitulo) {
    return (
      <div className="contenedor">
        <p>Cargando capítulo...</p>
      </div>
    );
  }

  if (!capitulo) {
    return (
      <div className="contenedor">
        <p>Capítulo no encontrado.</p>
        <Link to="/">Volver</Link>
      </div>
    );
  }

  const enProceso = estado === 'transcribiendo' || estado === 'pendiente';
  const analizando = estado === 'analizando';

  return (
    <div className="contenedor">
      <Link to="/">← Volver a capítulos</Link>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="campo" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label>Título del capítulo</label>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} onBlur={handleGuardarTitulo} />
          </div>
          <span className={`badge badge-${estado}`}>{ETIQUETAS_ESTADO[estado] || estado}</span>
        </div>
        <p style={{ fontSize: 13, color: '#6b7280' }}>Fecha del sermón: {capitulo.fecha_sermon}</p>

        {errorDetalle && (
          <p style={{ color: '#dc2626', fontSize: 13 }}>Error: {errorDetalle}</p>
        )}

        {mensajePromover && (
          <p style={{ fontSize: 13, color: '#1d4ed8' }}>{mensajePromover}</p>
        )}

        <button className="boton" onClick={handlePromover} disabled={promoviendo || estado !== 'listo'}>
          {promoviendo ? 'Agregando...' : capitulo.promovido ? 'Actualizar en el libro' : 'Subir al libro'}
        </button>
      </div>

      {enProceso && (
        <div className="card">
          <p><span className="spinner"></span>Transcribiendo el audio... esto puede tardar varios minutos dependiendo de la duración del sermón.</p>
        </div>
      )}

      {!enProceso && !capitulo.texto_actual && (
        <div className="card">
          <p>Aún no hay texto disponible para este capítulo.</p>
        </div>
      )}

      {capitulo.texto_actual && (
        <div className="layout-editor">
          <CapituloEditorComponent
            capitulo={capitulo}
            sugerencias={sugerencias}
            onSugerenciaClick={setSugerenciaActivaId}
            onTextoChange={() => {}}
          />

          <div>
            {analizando && (
              <div className="card">
                <p><span className="spinner"></span>Analizando el texto con IA, las sugerencias aparecerán pronto...</p>
              </div>
            )}
            <SugerenciasPanel
              capituloId={id}
              sugerencias={sugerencias}
              sugerenciaActivaId={sugerenciaActivaId}
              onSugerenciasActualizadas={handleSugerenciasActualizadas}
            />
          </div>
        </div>
      )}
    </div>
  );
}
