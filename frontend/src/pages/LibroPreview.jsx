import { useEffect, useState } from 'react';
import { obtenerLibro, api } from '../services/api';

export default function LibroPreview() {
  const [libro, setLibro] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [descargando, setDescargando] = useState(null);

  useEffect(() => {
    obtenerLibro()
      .then(setLibro)
      .catch((err) => console.error(err))
      .finally(() => setCargando(false));
  }, []);

  async function descargar(formato) {
    try {
      setDescargando(formato);
      const response = await api.get(`/libro/${formato}`, { responseType: 'blob' });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `libro-predicas.${formato === 'pdf' ? 'pdf' : 'docx'}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Error al generar el archivo. Asegúrate de tener al menos un capítulo en el libro.');
    } finally {
      setDescargando(null);
    }
  }

  if (cargando) {
    return (
      <div className="contenedor">
        <p>Cargando...</p>
      </div>
    );
  }

  const capitulos = libro?.capitulos || [];

  return (
    <div className="contenedor">
      <h1>{libro?.config?.titulo_libro || 'Libro de Prédicas'}</h1>

      <div className="card">
        <h2>Descargar libro completo</h2>
        <p>El libro tiene actualmente {capitulos.length} capítulo(s).</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="boton" onClick={() => descargar('pdf')} disabled={descargando !== null || capitulos.length === 0}>
            {descargando === 'pdf' ? 'Generando PDF...' : 'Descargar PDF'}
          </button>
          <button className="boton boton-secundario" onClick={() => descargar('word')} disabled={descargando !== null || capitulos.length === 0}>
            {descargando === 'word' ? 'Generando Word...' : 'Descargar Word'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Índice</h2>
        {capitulos.length === 0 ? (
          <p>Aún no hay capítulos agregados al libro. Edita un capítulo y usa el botón "Subir al libro".</p>
        ) : (
          <ol>
            {capitulos.map((cap) => (
              <li key={cap.id}>
                {cap.titulo} <span style={{ color: '#9ca3af', fontSize: 12 }}>({cap.fecha_sermon})</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
