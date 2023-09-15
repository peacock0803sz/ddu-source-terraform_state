import { TextLineStream } from "https://deno.land/std@0.197.0/streams/text_line_stream.ts";
import { GetPreviewerArguments } from "https://deno.land/x/ddu_vim@v3.4.6/base/kind.ts";
import {
  ActionArguments,
  ActionFlags,
  BaseKind,
  Previewer,
} from "https://deno.land/x/ddu_vim@v3.4.6/types.ts";
import { Denops } from "https://deno.land/x/denops_core@v5.0.0/mod.ts";
import * as chunkedStream from "https://deno.land/x/chunked_stream@0.1.2/mod.ts";

import { ErrorStream } from "../ddu-source-terraform_state/stream.ts";

type Params = Record<string, unknown>;
type Never = Record<never, never>;

export type ActionData = {
  cwd: string;
  name: string;
};

async function getState(denops: Denops, cwd: string, name: string) {
  const { status, stderr, stdout } = new Deno.Command("terraform", {
    args: ["state", "show", name],
    cwd: cwd,
    stdin: "null",
    stderr: "piped",
    stdout: "piped",
  }).spawn();
  status.then((code) => {
    if (code.success) return;
    stderr
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream())
      .pipeTo(new ErrorStream(denops));
  });

  let result: string[] = [];
  await stdout.pipeThrough(new TextDecoderStream()).pipeThrough(
    new TextLineStream(),
  ).pipeThrough(
    new chunkedStream.ChunkedStream({
      chunkSize: 1000,
    }),
  ).pipeTo(
    new WritableStream<string[]>({
      write: (chunk: string[]) => {
        result = result.concat(chunk);
      },
    }),
  );
  return result;
}

export class Kind extends BaseKind<Params> {
  override actions: Record<
    string,
    (args: ActionArguments<Never>) => Promise<ActionFlags>
  > = {};

  override async getPreviewer(
    args: GetPreviewerArguments,
  ): Promise<Previewer | undefined> {
    const action = args.item.action as ActionData;
    const state = await getState(args.denops, action.cwd, action.name);
    if (state === undefined) {
      args.denops.call("ddu#util#print_error", "failed to get state");
      return;
    }
    return {
      kind: "nofile",
      contents: state,
      filetype: "terraform",
    };
  }

  params(): Params {
    return {};
  }
}
