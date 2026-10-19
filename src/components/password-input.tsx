"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export function PasswordInput({
  label,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & { label: string }) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = `${visible ? "Hide" : "Show"} ${label.toLowerCase()}`;

  return (
    <div className="password-input-wrap">
      <Input {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="password-visibility-toggle"
        aria-label={toggleLabel}
        aria-controls={props.id}
        title={toggleLabel}
        disabled={props.disabled}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </button>
    </div>
  );
}
