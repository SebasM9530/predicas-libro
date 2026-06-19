import { useEffect, useState } from 'react';
import { obtenerLibro, despromoverCapitulo, api } from '../services/api';

export default function LibroPreview() {
  const [libro, setLibro] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [descargando, setDescargando] = useState(null);
  const [quitando, setQuitando] = useState(null);

  async function cargar() {
    try {
      setCargando(true);
      const data = await obtenerLibro();
      setLibro(data);
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
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

  async function handleQuitar(capituloId) {
    try {
      setQuitando(capituloId);
      await despromoverCapitulo(capituloId);
      await cargar();
    } catch (err) {
      console.error(err);
    } finally {
      setQuitando(null);
    }
  }

  if (cargando) {
    return (
      <div className="page">
        <div className="empty-state">
          <span className="empty-state__icon">···</span>
          <p className="empty-state__text">Cargando...</p>
        </div>
      </div>
    );
  }

  const capitulos = libro?.capitulos || [];

  return (
    <div className="page">
      <p className="page__eyebrow">Vista previa</p>
      <h1 className="page__title">{libro?.config?.titulo_libro || 'Libro de Prédicas'}</h1>
      <hr className="page__rule" />

      <div className="panel">
        <span className="panel__ribbon"></span>
        <div className="section-header">
          <span className="section-header__icon">⇩</span>
          <div>
            <h2 className="section-header__title">Descargar libro completo</h2>
            <p className="section-header__subtitle">Genera el archivo a partir de los capítulos ya promovidos. Incluye numeración de páginas.</p>
          </div>
        </div>

        <div className="book-summary">
          <span className="book-summary__count">{capitulos.length}</span>
          <span className="book-summary__label">Capítulo(s) en el libro</span>
        </div>

        <div className="download-actions">
          <button className="btn btn--primary" onClick={() => descargar('pdf')} disabled={descargando !== null || capitulos.length === 0}>
            {descargando === 'pdf' ? 'Generando PDF...' : 'Descargar PDF'}
          </button>
          <button className="btn btn--ghost" onClick={() => descargar('word')} disabled={descargando !== null || capitulos.length === 0}>
            {descargando === 'word' ? 'Generando Word...' : 'Descargar Word'}
          </button>
        </div>
      </div>

      <div className="panel">
        <span className="panel__ribbon panel__ribbon--forest"></span>
        <div className="section-header">
          <span className="section-header__icon">§</span>
          <div>
            <h2 className="section-header__title">Índice</h2>
            <p className="section-header__subtitle">Orden actual de los capítulos del libro.</p>
          </div>
        </div>

        {capitulos.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">Aún en blanco</span>
            <p className="empty-state__text">
              Aún no hay capítulos agregados al libro. Edita un capítulo y usa el botón "Subir al libro".
            </p>
          </div>
        ) : (
          <ol className="toc-list">
            {capitulos.map((cap, i) => (
              <li key={cap.id} className="toc-item">
                <span className="toc-item__number">{String(i + 1).padStart(2, '0')}</span>
                <span style={{ flex: 1 }}>{cap.titulo}</span>
                <span className="toc-item__date">{cap.fecha_sermon}</span>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => handleQuitar(cap.capitulo_id)}
                  disabled={quitando === cap.capitulo_id}
                  style={{ marginLeft: 12 }}
                >
                  {quitando === cap.capitulo_id ? 'Quitando...' : 'Quitar'}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}