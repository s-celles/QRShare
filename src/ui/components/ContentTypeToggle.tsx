import { t } from "../i18n";

interface ContentTypeToggleProps {
  value: "file" | "text";
  onChange: (type: "file" | "text") => void;
}

export function ContentTypeToggle({ value, onChange }: ContentTypeToggleProps) {
  return (
    <div class="content-type-toggle" role="radiogroup" aria-label="Content type">
      <button
        class={`toggle-option${value === "file" ? " active" : ""}`}
        role="radio"
        aria-checked={value === "file"}
        onClick={() => onChange("file")}
      >
        {t("text.contentTypeFile")}
      </button>
      <button
        class={`toggle-option${value === "text" ? " active" : ""}`}
        role="radio"
        aria-checked={value === "text"}
        onClick={() => onChange("text")}
      >
        {t("text.contentTypeText")}
      </button>
    </div>
  );
}
