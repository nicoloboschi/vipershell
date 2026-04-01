export default function HermesIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width={size} height={size} className={className} style={{ flexShrink: 0 }}>
      {/* Caduceus-inspired symbol for Hermes/Nous Research */}
      <path d="M12 2v20M12 2c-2 2-4 3-5 5s0 4 2 5c-3 1-4 3-3 5s3 3 6 3m0-18c2 2 4 3 5 5s0 4-2 5c3 1 4 3 3 5s-3 3-6 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="12" cy="2" r="1.5" fill="currentColor"/>
    </svg>
  );
}
