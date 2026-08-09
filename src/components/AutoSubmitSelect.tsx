"use client";

/**
 * A <select> that auto-submits its form on change.
 * Used for province/region filtering on the index page.
 */
export default function AutoSubmitSelect({
  name,
  defaultValue,
  options,
}: {
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      onChange={(e) => {
        // Submit the parent form via a hidden button so we keep all hidden inputs.
        const form = e.currentTarget.form;
        if (form) form.submit();
      }}
      className="rounded-lg border border-black/15 bg-white/70 px-3 py-1.5 text-sm outline-none hover:border-green/50 focus:border-green/50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}