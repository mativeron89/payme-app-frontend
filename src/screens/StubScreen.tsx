import { navigate } from '../router';

/**
 * Placeholder para pantallas de tiers futuros: la navegación del shell ya
 * funciona entera desde T1, pero el contenido llega en su tier (ver plan
 * en CLAUDE.md). Cada stub dice qué es y cuándo llega.
 */
export function StubScreen({ title, emoji, tier }: { title: string; emoji: string; tier: string }) {
  return (
    <div className="screen">
      <div className="top-bar">
        <button className="back-btn" onClick={() => navigate('home')}>
          ←
        </button>
        <div className="top-title">{title}</div>
      </div>
      <div className="stub">
        <div className="emoji">{emoji}</div>
        <div className="h2">{title}</div>
        <div className="body-text">Esta pantalla llega en el {tier}.</div>
        <button className="btn btn-navy" style={{ maxWidth: 220 }} onClick={() => navigate('home')}>
          🏠 Volver al inicio
        </button>
      </div>
    </div>
  );
}
