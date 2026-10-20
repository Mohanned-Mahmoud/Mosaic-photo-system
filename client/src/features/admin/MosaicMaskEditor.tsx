import { useState, useRef, useEffect } from "react";
import type { EventBranding } from "../../../../shared/mosaic";

interface Props {
  branding: EventBranding;
  logoUrl: string | null;
  onSave: (corners: number[] | undefined) => void;
  onCancel: () => void;
}

export default function MosaicMaskEditor({ branding, logoUrl, onSave, onCancel }: Props) {
  // [tl_x, tl_y, tr_x, tr_y, br_x, br_y, bl_x, bl_y]
  const [corners, setCorners] = useState<number[]>(branding.maskCorners || [0, 0, 1, 0, 1, 1, 0, 1]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activePoint, setActivePoint] = useState<number | null>(null);


  useEffect(() => {
    const handleMouseUp = () => setActivePoint(null);
    const handleMouseMove = (e: MouseEvent) => {
      if (activePoint === null || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setCorners(prev => {
        const next = [...prev];
        next[activePoint * 2] = x;
        next[activePoint * 2 + 1] = y;
        return next;
      });
    };
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [activePoint]);

  const clipPath = `polygon(${corners[0]*100}% ${corners[1]*100}%, ${corners[2]*100}% ${corners[3]*100}%, ${corners[4]*100}% ${corners[5]*100}%, ${corners[6]*100}% ${corners[7]*100}%)`;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <h2 style={{ color: 'white', marginBottom: '1rem' }}>Adjust Mosaic Grid Area</h2>
      <p style={{ color: '#ccc', marginBottom: '2rem', textAlign: 'center' }}>Drag the 4 corner points to map the mosaic grid onto your logo.<br/>The shaded area is where the photos will appear.</p>
      
      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '90vw', maxHeight: '70vh' }} ref={containerRef}>
        <img 
          src={logoUrl || ""} 
          alt="Mask reference" 
          style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', backgroundColor: branding.backgroundColor }} 
          draggable={false}
        />
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255, 255, 255, 0.2)', clipPath, pointerEvents: 'none', border: '1px solid rgba(255,255,255,0.5)' }} />
        
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            onMouseDown={(e) => { e.preventDefault(); setActivePoint(i); }}
            style={{
              position: 'absolute',
              left: `${corners[i * 2] * 100}%`,
              top: `${corners[i * 2 + 1] * 100}%`,
              width: 24,
              height: 24,
              marginLeft: -12,
              marginTop: -12,
              backgroundColor: 'var(--mosaic-accent)',
              borderRadius: '50%',
              cursor: 'grab',
              boxShadow: '0 0 10px rgba(0,0,0,0.5)',
              zIndex: 10
            }}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
        <button className="button button--quiet" onClick={() => onSave(undefined)}>RESET TO DEFAULT</button>
        <button className="button" onClick={onCancel}>CANCEL</button>
        <button className="button button--accent" onClick={() => onSave(corners)}>SAVE POINTS</button>
      </div>
    </div>
  );
}