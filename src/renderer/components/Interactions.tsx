import { useEffect, useState } from "react";
import type { UserInputRequest } from "../../shared/protocol";
import { replyToInput } from "../controller";
import { useUi } from "../store";

function InputRequest({ request }: { request: UserInputRequest }) {
  const connected = useUi((state) => state.connected);
  const [choice, setChoice] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [expired, setExpired] = useState(() => Date.now() >= request.expiresAt);
  const [slow, setSlow] = useState(false);
  const fieldValue = (id: string) => (Object.hasOwn(values, id) ? values[id] : "");
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), Math.max(0, request.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [request.expiresAt]);
  useEffect(() => {
    if (!sent) return;
    // A core reply removes this request. Allow a retry if the acknowledgement is lost.
    const timer = setTimeout(() => {
      setSent(false);
      setSlow(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [sent]);
  const valid =
    request.kind === "choice"
      ? Boolean(choice)
      : request.fields.every((field) => !field.required || fieldValue(field.id).trim());
  const reply = (cancelled: boolean) => {
    if (!connected || sent || expired) return;
    setSent(true);
    setSlow(false);
    replyToInput(
      cancelled
        ? { t: "user_input.reply", requestId: request.requestId, cancelled: true }
        : {
            t: "user_input.reply",
            requestId: request.requestId,
            answer: request.kind === "choice" ? { choice } : { values },
          },
    );
  };
  return (
    <form
      className="input-request"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) reply(false);
      }}
    >
      <fieldset disabled={!connected || sent || expired}>
        <legend>{request.prompt}</legend>
        {request.kind === "choice"
          ? request.options.map((option) => (
              <label className="input-option" key={option.id}>
                <input
                  type="radio"
                  name={request.requestId}
                  value={option.id}
                  checked={choice === option.id}
                  onChange={() => setChoice(option.id)}
                  required
                />
                <span>
                  {option.label}
                  {option.description && <small>{option.description}</small>}
                </span>
              </label>
            ))
          : request.fields.map((field) => (
              <label className="input-field" key={field.id}>
                <span>
                  {field.label}
                  {field.required ? " (required)" : ""}
                </span>
                <input
                  type="text"
                  placeholder={field.placeholder}
                  required={field.required}
                  maxLength={4000}
                  value={fieldValue(field.id)}
                  onChange={(event) => setValues((previous) => ({ ...previous, [field.id]: event.target.value }))}
                />
              </label>
            ))}
        <div className="interaction-actions">
          <button type="submit" className="btn primary" disabled={!valid}>
            Send answer
          </button>
          <button type="button" className="btn" onClick={() => reply(true)}>
            Cancel
          </button>
        </div>
      </fieldset>
      {(sent || expired || slow) && (
        <p className="muted" role="status">
          {expired ? "This request has expired." : sent ? "Sending answer..." : "No confirmation received. Try again."}
        </p>
      )}
    </form>
  );
}

/** Independent requests remain available together; the canvas and prompt stay mounted. */
export function UserInputPanel() {
  const { pendingInputs, me, hub } = useUi();
  const requests = pendingInputs.filter((request) => !hub || !request.ownerId || request.ownerId === me?.id);
  if (!requests.length) return null;
  return (
    <aside className="user-input-panel" aria-label="Agent questions">
      <h2>Agent questions</h2>
      {requests.map((request) => (
        <InputRequest key={request.requestId} request={request} />
      ))}
    </aside>
  );
}
