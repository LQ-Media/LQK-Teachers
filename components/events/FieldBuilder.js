"use client";

import { useState } from "react";
import {
  FIELD_TYPES,
  FIELD_TYPE_KEYS,
  MAX_FIELDS,
  fieldTakesOptions,
  newFieldId,
} from "@/lib/events/fields";

/* The custom-questions editor.

   One card per question, in the order guests will see them. Every control is a
   plain form element — this is an admin screen used a handful of times per
   event, so there is nothing to gain from drag-and-drop and a lot to lose in
   touch handling. Reordering is two buttons.

   Options are edited as one-per-line text rather than a list of inputs: Karim
   builds these by pasting from a message or a spreadsheet column, and a
   textarea takes a paste of twelve choices in one go. */

const input =
  "w-full rounded-control border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-gold";
const tinyLabel = "mb-1 block text-xs font-semibold text-charcoal-soft";

/* The three Karim named when he asked for this. A one-tap start beats an empty
   card, and these carry the right type and validation already. */
const QUICK_ADDS = [
  { label: "Full name", type: "text", scope: "attendee", required: true },
  { label: "Mobile number", type: "phone", scope: "family", required: true },
  { label: "Email address", type: "email", scope: "family", required: false },
];

function blankField(existing, preset = {}) {
  return {
    id: newFieldId(existing),
    type: "text",
    label: "",
    hint: "",
    required: false,
    scope: "family",
    when: "yes",
    options: [],
    ...preset,
  };
}

export default function FieldBuilder({ fields, onChange, drivePlaceholder }) {
  const [openId, setOpenId] = useState(null);

  function update(id, patch) {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function add(preset) {
    if (fields.length >= MAX_FIELDS) return;
    const field = blankField(fields, preset);
    onChange([...fields, field]);
    setOpenId(field.id);
  }

  function remove(id) {
    onChange(fields.filter((f) => f.id !== id));
  }

  function move(index, delta) {
    const next = [...fields];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div>
      {fields.length ? (
        <ul className="grid gap-3">
          {fields.map((field, index) => {
            const open = openId === field.id;
            const perPerson = field.scope === "attendee";
            return (
              <li key={field.id} className="rounded-control border border-line bg-paper">
                <div className="flex items-center gap-2 p-3">
                  <div className="flex shrink-0 flex-col">
                    {[
                      [-1, "▲", "Move up", index === 0],
                      [1, "▼", "Move down", index === fields.length - 1],
                    ].map(([delta, glyph, title, disabled]) => (
                      <button
                        key={title}
                        type="button"
                        title={title}
                        aria-label={`${title}: ${field.label || "untitled question"}`}
                        disabled={disabled}
                        onClick={() => move(index, delta)}
                        className="px-1 text-[9px] leading-tight text-charcoal-soft transition-transform duration-150 ease-out active:scale-90 disabled:opacity-25"
                      >
                        {glyph}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : field.id)}
                    aria-expanded={open}
                    className="min-w-0 flex-1 text-start"
                  >
                    <span className="block truncate text-sm font-semibold text-ink">
                      {field.label || <span className="text-charcoal-soft">Untitled question</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-charcoal-soft">
                      {FIELD_TYPES[field.type]?.label || field.type}
                      {" · "}
                      {perPerson ? "each person" : "once per family"}
                      {field.required ? " · required" : ""}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => remove(field.id)}
                    aria-label={`Remove ${field.label || "untitled question"}`}
                    className="shrink-0 rounded-pill px-2.5 py-1 text-xs font-semibold text-rust transition-transform duration-150 ease-out active:scale-95"
                  >
                    Remove
                  </button>
                </div>

                {open ? (
                  <div className="grid gap-3 border-t border-line px-3 py-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className={tinyLabel} htmlFor={`${field.id}-label`}>
                        Question
                      </label>
                      <input
                        id={`${field.id}-label`}
                        className={input}
                        value={field.label}
                        onChange={(e) => update(field.id, { label: e.target.value })}
                        placeholder="Full name"
                      />
                    </div>

                    <div>
                      <label className={tinyLabel} htmlFor={`${field.id}-type`}>
                        Answer type
                      </label>
                      <select
                        id={`${field.id}-type`}
                        className={input}
                        value={field.type}
                        onChange={(e) => update(field.id, { type: e.target.value })}
                      >
                        {FIELD_TYPE_KEYS.map((key) => (
                          <option key={key} value={key}>
                            {FIELD_TYPES[key].label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-charcoal-soft">{FIELD_TYPES[field.type]?.hint}</p>
                      {field.type === "file" && drivePlaceholder ? (
                        <p className="mt-1 text-xs text-rust">{drivePlaceholder}</p>
                      ) : null}
                    </div>

                    <div>
                      <label className={tinyLabel} htmlFor={`${field.id}-scope`}>
                        Ask
                      </label>
                      <select
                        id={`${field.id}-scope`}
                        className={input}
                        value={field.scope}
                        onChange={(e) => update(field.id, { scope: e.target.value })}
                      >
                        <option value="family">Once per family</option>
                        <option value="attendee">For every person coming</option>
                      </select>
                      <p className="mt-1 text-xs text-charcoal-soft">
                        {perPerson
                          ? "The form repeats this for each head in their party."
                          : "Asked once, of whoever opens the invitation."}
                      </p>
                    </div>

                    {!perPerson ? (
                      <div>
                        <label className={tinyLabel} htmlFor={`${field.id}-when`}>
                          Show it to
                        </label>
                        <select
                          id={`${field.id}-when`}
                          className={input}
                          value={field.when}
                          onChange={(e) => update(field.id, { when: e.target.value })}
                        >
                          <option value="yes">Only families who are coming</option>
                          <option value="any">Everyone, coming or not</option>
                        </select>
                      </div>
                    ) : null}

                    <div className="flex items-end">
                      <label className="flex items-center gap-2 pb-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="size-4 accent-gold"
                          checked={field.required}
                          onChange={(e) => update(field.id, { required: e.target.checked })}
                        />
                        Required
                      </label>
                    </div>

                    <div className="sm:col-span-2">
                      <label className={tinyLabel} htmlFor={`${field.id}-hint`}>
                        Helper line <span className="font-normal">(optional)</span>
                      </label>
                      <input
                        id={`${field.id}-hint`}
                        className={input}
                        value={field.hint}
                        onChange={(e) => update(field.id, { hint: e.target.value })}
                        placeholder="As it appears on their IC"
                      />
                    </div>

                    {fieldTakesOptions(field.type) ? (
                      <div className="sm:col-span-2">
                        <label className={tinyLabel} htmlFor={`${field.id}-options`}>
                          Choices — one per line
                        </label>
                        <textarea
                          id={`${field.id}-options`}
                          className={`${input} min-h-24 font-mono text-xs`}
                          value={field.options.join("\n")}
                          onChange={(e) =>
                            update(field.id, { options: e.target.value.split(/\r?\n/) })
                          }
                          placeholder={"Vegetarian\nNo beef\nNut allergy"}
                        />
                        {!field.options.some((o) => o.trim()) ? (
                          <p className="mt-1 text-xs text-rust">
                            A question with no choices can&rsquo;t be answered — it won&rsquo;t be shown
                            to guests until you add some.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-control border border-dashed border-line px-4 py-5 text-center text-sm text-charcoal-soft">
          No extra questions. Guests are asked the built-in ones: coming or not, how many
          adults and children, and a message.
        </p>
      )}

      {fields.length < MAX_FIELDS ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => add()}
            className="rounded-pill border border-line px-4 py-2 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Add a question
          </button>
          <span className="text-xs text-charcoal-soft">or start from</span>
          {QUICK_ADDS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => add(preset)}
              className="rounded-pill bg-sand px-3 py-1.5 text-xs font-semibold text-gold-hover transition-transform duration-150 ease-out active:scale-[0.97]"
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-charcoal-soft">
          That&rsquo;s the maximum of {MAX_FIELDS} questions.
        </p>
      )}
    </div>
  );
}
