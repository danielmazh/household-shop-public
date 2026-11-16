import { useEffect, useRef, useState } from "preact/hooks";
import { packsAtHome, targetPacks } from "../domain/planner";
import type { Settings } from "../domain/schedule";
import type { Item } from "../domain/types";
import { itemEmoji } from "./emoji";
import { CheckIcon } from "./icons";
import { t } from "./i18n";
import { formatNumber, packWord } from "./labels";
import { Stepper } from "./parts";

interface Props {
  item: Item;
  settings: Settings;
  /** Unused since spec 014 (no trip day to show). */
  today: number;
  canWrite: boolean;
  /** Lowers stock by this many packs. */
  onUse: (item: Item, packs: number) => Promise<boolean>;
  /** Stock 0 and ranOut: on the next trip of any kind. */
  onAllGone: (item: Item) => Promise<boolean>;
  onClose: () => void;
}

/**
 * "השתמשתי ב..." (spec 009): how many packs were used, what is left at home,
 * and how much the list fills back to the target.
 */
export function UseSheet({
  item,
  settings,
  canWrite,
  onUse,
  onAllGone,
  onClose,
}: Props) {
  const home = packsAtHome(item);
  const target = targetPacks(item, settings);
  const max = Math.max(1, Math.ceil(home));
  const [used, setUsed] = useState(1);
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Focus once when opened; Escape closes.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button.btn.primary")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const left = Math.max(0, Math.round((home - used) * 10) / 10);
  const toBuy = Math.max(0, Math.ceil(target - left - 1e-9));
  // Spec 014: one list, no trip name or day.
  const word = packWord(item);

  const run = async (action: () => Promise<boolean>) => {
    if (await action()) onClose();
  };

  return (
    <div
      class="sheet-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="use-title"
      >
        <div class="sheet-head">
          <span class="big-tile" aria-hidden="true">
            {itemEmoji(item)}
          </span>
          <h2 id="use-title">{item.name}</h2>
        </div>
        {home <= 0 ? (
          <>
            <p class="use-math">
              {t("noneAtHome")}
              <br />
              {t("nextTripPlus")(Math.max(1, target))}
            </p>
            <button
              type="button"
              class="btn primary full"
              disabled={!canWrite || item.ranOut}
              onClick={() => void run(() => onAllGone(item))}
            >
              <CheckIcon size={22} />
              {item.ranOut ? t("alreadyListed") : t("addToNext")}
            </button>
            <button type="button" class="btn text" onClick={onClose}>
              {t("cancel")}
            </button>
          </>
        ) : (
          <>
            <div class="setting-row">
              <span class="field-label">{t("iUsed")}</span>
              <Stepper
                value={`${used} ${packWord(item, used)}`}
                label={t("useStepper")}
                minusDisabled={used <= 1}
                plusDisabled={used >= max}
                onMinus={() => setUsed(used - 1)}
                onPlus={() => setUsed(used + 1)}
              />
            </div>
            <p class="use-math" aria-live="polite">
              {t("atHome")} <bdi>{formatNumber(home)}</bdi> {t("arrow")}{" "}
              <strong>
                <bdi>{formatNumber(left)}</bdi>
              </strong>{" "}
              {word}
              <br />
              {toBuy > 0 ? (
                t("fillsTo")(toBuy, target)
              ) : (
                t("aboveBase")(target)
              )}
            </p>
            <button
              type="button"
              class="btn primary full"
              disabled={!canWrite}
              onClick={() => void run(() => onUse(item, used))}
            >
              <CheckIcon size={22} />
              {t("confirm")}
            </button>
            <div class="btn-row">
              <button
                type="button"
                class="btn secondary"
                disabled={!canWrite}
                onClick={() => void run(() => onAllGone(item))}
              >
                {t("allGone")}
              </button>
              <button type="button" class="btn text" onClick={onClose}>
                {t("cancel")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
