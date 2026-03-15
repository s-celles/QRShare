import { t } from "../i18n";

const MAX_TEXT_LENGTH = 100_000;

interface TextInputAreaProps {
  value: string;
  onChange: (text: string) => void;
  maxLength?: number;
  disabled?: boolean;
}

export function TextInputArea({
  value,
  onChange,
  maxLength = MAX_TEXT_LENGTH,
  disabled = false,
}: TextInputAreaProps) {
  return (
    <div class="text-input-area">
      <textarea
        value={value}
        onInput={(e) => {
          const text = (e.target as HTMLTextAreaElement).value;
          if (text.length <= maxLength) {
            onChange(text);
          }
        }}
        placeholder={t("text.placeholder")}
        maxLength={maxLength}
        disabled={disabled}
        rows={6}
        class="text-input-textarea"
        aria-label={t("text.placeholder")}
      />
      <div class="text-char-count" aria-live="polite">
        {t("text.charCount", { count: value.length, max: maxLength })}
      </div>
    </div>
  );
}
