export default function OpenAIIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/openai.png"
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0, objectFit: 'contain' }}
    />
  );
}
