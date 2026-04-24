import React from "react";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export default function Spinner({
  size = "md",
  className = "",
}: SpinnerProps) {
  const sizeClass = `spinner-${size}`;
  return <div className={`spinner ${sizeClass} ${className}`} />;
}
