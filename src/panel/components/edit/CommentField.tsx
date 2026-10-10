import { useId } from "react"

import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"

/** "What should the AI do with this element?": exported as the element's Task, with or without style edits. */
export function CommentField({
  value,
  onChange,
}: {
  value: string
  onChange: (text: string) => void
}) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id} className="text-xs text-muted-foreground">
        Comment for the AI
      </FieldLabel>
      <Textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Make this a primary button and link it to /signup."
        className="min-h-14 text-xs"
      />
    </Field>
  )
}
