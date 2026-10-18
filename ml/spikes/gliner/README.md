# GLiNER on onnxruntime-node (spike, issue #5)

Model: `urchade/gliner_small-v2.1` (Apache-2.0, span-based, DeBERTa-v3-small encoder, 166M params).

Reproduce (from the repo root, Node 24):

```bash
cd ml
uv run python spikes/gliner/export_onnx.py [--quantize]   # -> ml/models/gliner_small-v2.1-onnx/ (gitignored)
uv run python spikes/gliner/reference_spans.py            # -> reference_spans.json (PyTorch + Python onnxruntime)
cd ../apps/agent
pnpm exec tsx scripts/gliner/run.ts [--runs 25] [--threads N] [--quantized]
```

`samples.json` holds 20 made-up texts (12 short, 8 of 264–299 model tokens) and 6 labels. Never commit the
`.onnx` files. Results and the go / no-go are on issue #5.
