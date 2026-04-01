interface ViperIconProps {
  size?: number;
  color?: string;
  className?: string;
}

export default function ViperIcon({ size = 16, color = 'currentColor', className }: ViperIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      {/* Stylized viper head as terminal prompt — jaw forms >, fang is cursor dot */}
      <path
        d="M4 6 L14 12 L4 18"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="16" r="1.8" fill={color} />
    </svg>
  );
}
