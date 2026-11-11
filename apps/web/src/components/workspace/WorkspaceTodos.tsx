import { useState } from "react";
import * as Schema from "effect/Schema";
import { Link } from "@tanstack/react-router";
import { PlusIcon, Trash2Icon } from "lucide-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { cn, randomUUID } from "../../lib/utils";

const todosSchema = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    done: Schema.Boolean,
    thread: Schema.NullOr(Schema.Struct({ environmentId: EnvironmentId, threadId: ThreadId })),
  }),
);

export function useWorkspaceTodos() {
  const [todos, setTodos] = useLocalStorage("t3code:workspace-todos:v1", [], todosSchema);
  const addThread = (thread: EnvironmentThreadShell) =>
    setTodos((items) => {
      if (
        items.some(
          (item) =>
            !item.done &&
            item.thread?.environmentId === thread.environmentId &&
            item.thread.threadId === thread.id,
        )
      )
        return items;
      return [
        ...items,
        {
          id: randomUUID(),
          title: thread.title,
          done: false,
          thread: { environmentId: thread.environmentId, threadId: thread.id },
        },
      ];
    });
  return { todos, setTodos, addThread };
}

export function WorkspaceTodos() {
  const { todos, setTodos } = useWorkspaceTodos();
  const [title, setTitle] = useState("");
  return (
    <section
      aria-labelledby="workspace-todos-title"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="workspace-todos-title" className="font-medium">
          To do
        </h2>
        <span className="text-xs text-muted-foreground">
          {todos.filter((item) => !item.done).length} open
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Saved in this browser. Add a thread with its + button.
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          setTodos((items) => [
            ...items,
            { id: randomUUID(), title: title.trim(), done: false, thread: null },
          ]);
          setTitle("");
        }}
      >
        <Input
          aria-label="New to-do"
          placeholder="What comes next?"
          value={title}
          maxLength={500}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label="Add to-do"
          disabled={!title.trim()}
        >
          <PlusIcon />
        </Button>
      </form>
      {todos.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Your next steps belong here.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {todos.map((item) => (
            <li key={item.id} className="flex items-start gap-2 py-3">
              <Checkbox
                aria-label={`Complete ${item.title}`}
                checked={item.done}
                onCheckedChange={(done) =>
                  setTodos((items) =>
                    items.map((entry) => (entry.id === item.id ? { ...entry, done } : entry)),
                  )
                }
              />
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block break-words text-sm",
                    item.done && "text-muted-foreground line-through",
                  )}
                >
                  {item.title}
                </span>
                {item.thread ? (
                  <Link
                    to="/$environmentId/$threadId"
                    params={item.thread}
                    className="text-xs text-muted-foreground underline underline-offset-4"
                  >
                    Open thread
                  </Link>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon-micro"
                aria-label={`Delete ${item.title}`}
                onClick={() => setTodos((items) => items.filter((entry) => entry.id !== item.id))}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
