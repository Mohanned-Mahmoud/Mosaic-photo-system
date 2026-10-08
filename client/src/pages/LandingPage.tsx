import { Link } from "wouter";
import { MosaicWordmark } from "../components/MosaicBrand";

export default function LandingPage() {
  return (
    <main className="landing-shell">
      <header className="landing-topbar">
        <MosaicWordmark />
        <span className="landing-edition">LIVE EVENT PHOTO EXPERIENCE</span>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero__copy">
          <p className="eyebrow"><span className="status-dot" />A ROOM FULL OF MOMENTS</p>
          <h1 id="landing-title">Your moment.<br /><em>On the big screen.</em></h1>
          <p className="landing-lede">
            A live photo experience that turns every guest into part of the room.
          </p>
          <div className="landing-actions">
            <Link href="/admin" className="button button--accent">Run an event <span aria-hidden="true">↗</span></Link>
            <Link href="/booth" className="landing-secondary">Open a photo booth <span aria-hidden="true">→</span></Link>
          </div>
        </div>

        <div className="landing-composition" aria-hidden="true">
          <div className="landing-frame landing-frame--one"><span /></div>
          <div className="landing-frame landing-frame--two"><span /></div>
          <div className="landing-frame landing-frame--three"><span /></div>
          <div className="landing-composition__seal"><span>M</span></div>
          <div className="landing-composition__caption"><span>THE WALL, IN MOTION</span><span>01 / 03</span></div>
        </div>
      </section>

      <footer className="landing-footer">
        <span>CAPTURE → CONNECT → COME ALIVE</span>
        <span>MADE FOR THE MOMENT, NOT THE FEED</span>
      </footer>
    </main>
  );
}
