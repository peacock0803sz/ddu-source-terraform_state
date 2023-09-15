import type { GatherArguments } from "https://deno.land/x/ddu_vim@v3.4.6/base/source.ts";
import { fn } from "https://deno.land/x/ddu_vim@v3.4.6/deps.ts";
import { BaseSource, Item } from "https://deno.land/x/ddu_vim@v3.4.6/types.ts";
import { TextLineStream } from "https://deno.land/std@0.197.0/streams/text_line_stream.ts";
import * as chunkedStream from "https://deno.land/x/chunked_stream@0.1.2/mod.ts";

import { ActionData } from "../@ddu-kinds/terraform_state.ts";
import { ErrorStream } from "../ddu-source-terraform_state/stream.ts";

type Params = {
  cwd?: string;
};

function parseLine(cwd: string, name: string): Item<ActionData> {
  return {
    word: name,
    action: { cwd, name },
  };
}

export class Source extends BaseSource<Params, ActionData> {
  override kind = "terraform_state";

  override gather({ denops, sourceParams }: GatherArguments<Params>) {
    return new ReadableStream<Item<ActionData>[]>({
      async start(controller) {
        const cwd = sourceParams.cwd ?? (await fn.getcwd(denops));
        const { status, stderr, stdout } = new Deno.Command("terraform", {
          args: ["state", "list"],
          cwd,
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

        stdout
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(new TextLineStream())
          .pipeThrough(
            new chunkedStream.ChunkedStream({
              chunkSize: 1000,
            }),
          )
          .pipeTo(
            new WritableStream<string[]>({
              write: (chunk: string[]) => {
                controller.enqueue(chunk.map((line) => parseLine(cwd, line)));
              },
            }),
          )
          .finally(() => controller.close());
      },
    });
  }

  override params(): Params {
    return {};
  }
}
