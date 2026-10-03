import { useEffect, useRef, type ReactNode } from "react";
import { X, FileText, ArrowRight } from "lucide-react";
import { errorText } from "./api";
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="error-notice" role="alert">
      {errorText(error)}
      {retry && (
        <button type="button" onClick={retry}>
          重试
        </button>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <FileText size={32} />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        ▰
      </span>
      <span>
        文启<small>FILEACTION</small>
      </span>
    </span>
  );
}
export function Hero() {
  return (
    <section className="hero">
      <div>
        <p className="eyebrow">LESS READING. MORE DOING.</p>
        <h2>从一份文件，到你的下一步。</h2>
        <p>先理解与你的关联，再由你决定是否行动。</p>
        <div className="hero-steps">
          <span>带着文件来</span>
          <ArrowRight size={14} />
          <span>找到与你的关联</span>
          <ArrowRight size={14} />
          <span>带着行动走</span>
        </div>
      </div>
      <div className="hero-symbol" aria-hidden="true">
        <FileText size={42} />
        <span>✦</span>
      </div>
    </section>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute("open", "");
    dialog
      ?.querySelector<HTMLElement>("button, input, textarea, select")
      ?.focus();
    return () => {
      dialog?.close?.();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={close}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
