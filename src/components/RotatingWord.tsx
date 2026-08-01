"use client";

import { useEffect, useState } from "react";

const WORDS = [
  "council",
  "committee",
  "organization",
  "non-profit",
  "charity",
  "business",
];

export default function RotatingWord() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % WORDS.length), 2200);
    return () => clearInterval(id);
  }, []);

  return (
    // Fixed width so the sentence doesn't reflow as words change length.
    <span className="relative inline-block min-w-[9ch] text-left align-baseline text-rust">
      <span key={i} className="animate-fade-up inline-block">
        {WORDS[i]}
      </span>
    </span>
  );
}
