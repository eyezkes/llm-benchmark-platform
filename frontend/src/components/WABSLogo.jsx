const WABSLogo = ({ size = 58, color = "white" }) => (
  <svg
    width={size}
    height={Math.round(size * 0.74)}
    viewBox="0 0 130 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M 8,52 L 8,10 L 24,10 L 24,44 L 42,80 L 57,36 L 57,6 L 73,6 L 73,42 L 90,80 L 118,18"
      stroke={color}
      strokeWidth="7.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M 118,30 L 118,18 L 108,24"
      stroke={color}
      strokeWidth="7.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default WABSLogo;
