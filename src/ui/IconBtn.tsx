import type { CSSProperties, MouseEvent, ReactNode } from "react";

interface Props {
  title: string;
  onClick?: (e: MouseEvent) => void;
  children: ReactNode;
  danger?: boolean;
  style?: CSSProperties;
}

export function IconBtn({ title, onClick, children, danger, style }: Props) {
  return (
    <button
      className="icon-btn"
      data-tip={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      style={{ color: danger ? "#c2506a" : "inherit", ...style }}
    >
      {children}
    </button>
  );
}
