import type { ComponentChildren, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { BackIcon, CloseIcon, MinusIcon, PlusIcon } from './icons';
import { t } from './i18n';

/** What a screen hands to the shell: header, content and bottom action. */
export interface FrameProps {
  /** Curved green header content, or nothing for a plain page. */
  hero?: ComponentChildren;
  children: ComponentChildren;
  /** Sticky action above the tab bar (finish, save). */
  dock?: ComponentChildren;
  /** Focused view: no tab bar (stock count, edit forms). */
  focus?: boolean;
  /** Catalog and stock grids may widen to 720 px at 1024 px and up. */
  wide?: boolean;
}

export type Frame = (props: FrameProps) => JSX.Element;

interface LayoutProps extends FrameProps {
  banners?: ComponentChildren;
  tabs?: ComponentChildren;
}

/** One centered column: header, content, sticky bar and tab bar share its edges. */
export function Layout({ hero, children, dock, focus, wide, banners, tabs }: LayoutProps) {
  const cls = ['app', focus ? 'focus' : '', wide ? 'wide' : ''].filter(Boolean).join(' ');
  const bottom = dock || (!focus && tabs);
  return (
    <div class={cls}>
      {hero && (
        <header class="hero">
          <div class="col">{hero}</div>
        </header>
      )}
      <main class="col main">
        {banners}
        {children}
      </main>
      {bottom && (
        <div class="dock">
          <div class="col">
            {dock}
            {!focus && tabs}
          </div>
        </div>
      )}
    </div>
  );
}

/** Title block of a plain page, with an optional back or close button on the start side. */
export function PageHead({ title, sub, back, close }: { title: string; sub?: ComponentChildren; back?: { label: string; onClick: () => void }; close?: { label: string; onClick: () => void } }) {
  const nav = back ?? close;
  return (
    <div class="page-head">
      {nav && (
        <div>
          <button type="button" class="icon-btn" aria-label={nav.label} onClick={nav.onClick}>
            {back ? <BackIcon size={24} /> : <CloseIcon size={24} />}
          </button>
        </div>
      )}
      <h1>{title}</h1>
      {sub && <p class="sub">{sub}</p>}
    </div>
  );
}

interface RadioOption<T> {
  value: T;
  label: ComponentChildren;
  /** Accessible name when the label is not plain text. */
  name?: string;
}

/**
 * A row of pills that acts as a radio group: one tab stop, arrow keys move
 * and select (RTL: right arrow goes back), Home and End jump.
 */
export function RadioPills<T extends string | number>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  class: cls = 'chip-row',
  itemClass = 'chip',
}: {
  label?: string;
  labelledBy?: string;
  options: RadioOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  class?: string;
  itemClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const index = options.findIndex((o) => o.value === value);
  const focusAt = (n: number) => {
    const next = (n + options.length) % options.length;
    onChange(options[next]!.value);
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const at = Math.max(0, index);
    const rtl = getComputedStyle(e.currentTarget as Element).direction === 'rtl';
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
    const bwd = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === fwd || e.key === 'ArrowDown') focusAt(at + 1);
    else if (e.key === bwd || e.key === 'ArrowUp') focusAt(at - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(options.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} aria-labelledby={labelledBy} class={cls} onKeyDown={onKey}>
      {options.map((o, n) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          class={itemClass}
          aria-checked={o.value === value}
          aria-label={o.name}
          tabIndex={n === (index < 0 ? 0 : index) ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small grid of curated emoji, a radio group. */
export function EmojiPicker({ id, choices, value, onChange }: { id: string; choices: string[]; value: string; onChange: (emoji: string) => void }) {
  // A custom emoji takes the first cell, so the grid keeps its 12 cells (6 x 2 or 4 x 3).
  const list = choices.includes(value) || !value ? choices : [value, ...choices.slice(0, -1)];
  const options = list.map((e) => ({ value: e, label: <span aria-hidden="true">{e}</span>, name: e }));
  return (
    <div class="field emoji-field">
      <span class="field-label" id={id}>
        {t('icon')}
      </span>
      <RadioPills labelledBy={id} options={options} value={value} onChange={onChange} class="emoji-grid" itemClass="" />
    </div>
  );
}

/** Minus, value, plus. Plus sits on the end side: left in RTL, right in LTR. */
export function Stepper({ value, label, onMinus, onPlus, minusDisabled, plusDisabled }: { value: ComponentChildren; label: string; onMinus: () => void; onPlus: () => void; minusDisabled?: boolean; plusDisabled?: boolean }) {
  return (
    <span class="stepper">
      <button type="button" aria-label={t('less')(label)} disabled={minusDisabled} onClick={onMinus}>
        <MinusIcon size={22} />
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label={t('more')(label)} disabled={plusDisabled} onClick={onPlus}>
        <PlusIcon size={22} />
      </button>
    </span>
  );
}
