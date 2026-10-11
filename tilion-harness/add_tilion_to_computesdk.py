#!/usr/bin/env python3
"""Add Tilion as a provider to a checkout of github.com/computesdk/benchmarks, so their own
harness (Node 24, benchsdk-runner, tti.bench.ts) measures us exactly as it measures everyone
else. Copies integrations/computesdk/src into the checkout and registers it in providers.ts.

    python benchmarks/add_tilion_to_computesdk.py path/to/computesdk-benchmarks
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
checkout = pathlib.Path(sys.argv[1]).resolve()
dest = checkout / "benchmarks" / "sandbox" / "tilion-provider"
shutil.rmtree(dest, ignore_errors=True)
shutil.copytree(HERE / "provider", dest)

providers = checkout / "benchmarks" / "sandbox" / "providers.ts"
s = providers.read_text()
if "tilion-provider" not in s:
    s = "import { tilion } from './tilion-provider/index';\n" + s
    anchor = "export const providers: ProviderConfig[] = ["
    assert anchor in s, "providers.ts layout changed"
    s = s.replace(anchor, anchor + """
  {
    name: 'tilion',
    requiredEnvVars: ['TILION_API_KEY'],
    createCompute: () => tilion({ apiKey: process.env.TILION_API_KEY!, baseUrl: process.env.TILION_BASE_URL }),
  },""", 1)
    providers.write_text(s)
print(f"tilion added to {providers}")
