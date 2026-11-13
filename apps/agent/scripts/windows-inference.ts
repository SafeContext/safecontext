/** W4: opt-in diagnostics; prediction verification additionally needs a matching reference. */
import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { freemem, totalmem, cpus } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadGliner } from '../src/classifier/tier1/gliner.ts';
import { createTier2Client } from '../src/classifier/tier2/client.ts';
import { tier2FromConfig } from '../src/classifier/tier2/tier2.ts';
import { DEFAULT_TIER2_BASE_URL, PINNED_TIER2_MODEL, PINNED_TIER2_DIGEST, readConfig } from '../src/config.ts';
import {
	checkInference,
	smokeTier1,
	InferenceCheckError,
	parseReference,
	verifyOllamaPin,
	inferenceEnvironment
} from '../src/diagnostics/inference-check.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ml = join(root, 'ml');
const require = createRequire(import.meta.url);
let mode = 'preflight';
const modes = ['preflight', 'smoke-tier1', 'tier1', 'combined', 'start-tier1', 'start-combined'];
const emit = (value: unknown) => console.log(JSON.stringify(value));

try {
	const { values, positionals } = parseArgs({
		options: {
			python: { type: 'string' },
			reference: { type: 'string' },
			'run-models': { type: 'boolean', default: false }
		},
		allowPositionals: true
	});
	mode = positionals[0] ?? 'preflight';
	if (positionals.length > 1 || !modes.includes(mode)) throw new InferenceCheckError('unsupported_mode_or_arguments');
	if (values.python && !isAbsolute(values.python)) throw new InferenceCheckError('python_path_must_be_absolute');
	const lock = JSON.parse(await readFile(join(ml, 'models.lock.json'), 'utf8')) as {
		artifacts: Array<{ name: string; revision: string; local_dir: string; files: Array<{ size: number }> }>;
		external: Array<{ name: string; runtime: string; model: string; digest: string }>;
	};
	const art = lock.artifacts.find((a) => a.name === 'tier1-onnx');
	const external = lock.external.find((a) => a.name === 'tier2-llm');
	if (
		!art ||
		!/^[0-9a-f]{40}$/.test(art.revision) ||
		art.local_dir !== 'models/tier1-onnx' ||
		!external ||
		external.runtime !== 'ollama' ||
		external.model !== PINNED_TIER2_MODEL ||
		external.digest !== PINNED_TIER2_DIGEST
	)
		throw new InferenceCheckError('manifest_pin_mismatch');
	const pins = { revision: art.revision, model: external.model, digest: external.digest };
	const verifyFiles = () =>
		new Promise<boolean>((resolve) => {
			// -S status needs only the standard library; uv fallback is strictly offline/locked.
			const args = values.python
				? ['-S', join(ml, 'download.py'), 'status']
				: ['run', '--offline', '--locked', join(ml, 'download.py'), 'status'];
			execFile(
				values.python ?? (process.platform === 'win32' ? 'uv.exe' : 'uv'),
				args,
				{ cwd: root, timeout: 30_000, maxBuffer: 65536, windowsHide: true },
				(error) => resolve(!error)
			);
		});
	const modelDir = join(ml, art.local_dir);
	if (mode === 'preflight') {
		const filesVerified = await verifyFiles();
		let nativeBinding = false;
		try {
			await import('onnxruntime-node');
			nativeBinding = true;
		} catch {
			/* Static metadata only. */
		}
		emit({
			stage: 'preflight',
			platform: process.platform,
			arch: process.arch,
			node: process.version,
			cpu: cpus()[0]?.model,
			logicalCpus: cpus().length,
			ramGiB: totalmem() / 2 ** 30,
			availableGiB: freemem() / 2 ** 30,
			onnxRuntime: (require('onnxruntime-node/package.json') as { version: string }).version,
			nativeBinding,
			tier1Files: filesVerified ? 'verified' : 'not_verified',
			tier1FileCount: art.files.length,
			tier1Bytes: art.files.reduce((n, f) => n + f.size, 0),
			modelInference: 'not_run',
			matchingReference: 'required_for_prediction_verification',
			ollama: 'not_contacted',
			policyBudgetMs: 8000,
			tier2CallBudgetMs: 6000
		});
		process.exitCode = filesVerified && nativeBinding ? 0 : 2;
	} else {
		if (!values['run-models']) throw new InferenceCheckError('model_run_opt_in_required');
		if (mode === 'smoke-tier1') {
			const timer = setTimeout(() => {
				emit({ stage: mode, status: 'failed', reason: 'run_time_limit' });
				process.exit(1);
			}, 180_000);
			try {
				emit({
					...(await smokeTier1({
						verifyFiles,
						availableMemory: freemem,
						loadModel: () => loadGliner(modelDir, { threads: 2 })
					})),
					modelRevision: pins.revision,
					threads: 2,
					providerConfiguration: 'onnxruntime-node default CPU'
				});
			} finally {
				clearTimeout(timer);
			}
		} else {
			if (!values.reference) throw new InferenceCheckError('matching_approved_reference_required');
			const refInfo = await stat(values.reference);
			if (refInfo.size > 65536) throw new InferenceCheckError('reference_too_large');
			const combined = mode.includes('combined');
			const reference = parseReference(JSON.parse(await readFile(values.reference, 'utf8')), pins.revision, combined);
			const client = createTier2Client({ baseUrl: DEFAULT_TIER2_BASE_URL, model: pins.model });
			const listModels = () => client.listModels(3000);
			if (mode.startsWith('start-')) {
				if (!(await verifyFiles())) throw new InferenceCheckError('tier1_files_not_verified');
				if (freemem() < (combined ? 10 : 3) * 2 ** 30) throw new InferenceCheckError('insufficient_available_memory');
				if (combined) verifyOllamaPin(await listModels(), pins);
				// Only this child receives the demo settings; never inherit company policy/sync credentials.
				const env = inferenceEnvironment(process.env, modelDir, combined);
				emit({
					stage: mode,
					modelReadiness: 'not_established_by_http_health',
					syntheticDefaultPolicy: true,
					port: 4747
				});
				const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'apps/agent/src/index.ts')], {
					cwd: join(root, 'apps/agent'),
					env,
					stdio: 'inherit',
					windowsHide: true
				});
				const stop = () => child.kill('SIGTERM');
				process.once('SIGINT', stop);
				process.once('SIGTERM', stop);
				const code = await new Promise<number>((resolve) => {
					child.once('error', () => resolve(1));
					child.once('exit', (exit) => resolve(exit ?? 1));
				});
				process.removeListener('SIGINT', stop);
				process.removeListener('SIGTERM', stop);
				process.exitCode = code;
			} else {
				// Hard process limit also bounds a native model call that cannot honor JS cancellation.
				const timer = setTimeout(
					() => {
						emit({ stage: mode, status: 'failed', reason: 'run_time_limit' });
						process.exit(1);
					},
					combined ? 300_000 : 180_000
				);
				try {
					const result = await checkInference(combined ? 'combined' : 'tier1', reference, pins, {
						verifyFiles,
						listModels,
						availableMemory: freemem,
						loadModel: () => loadGliner(modelDir, { threads: 2 }),
						startTier2: (logger) =>
							tier2FromConfig(
								readConfig({ SC_TIER2_MODEL: pins.model, SC_TIER2_BASE_URL: DEFAULT_TIER2_BASE_URL }).tier2,
								logger
							)!
					});
					emit({
						...result,
						modelRevision: pins.revision,
						providerConfiguration: 'onnxruntime-node default CPU',
						threads: 2,
						warmP95Below300ms: combined ? null : result.warm.p95Ms < 300
					});
					process.exitCode = !combined && result.warm.p95Ms >= 300 ? 2 : 0;
				} finally {
					clearTimeout(timer);
				}
			}
		}
	}
} catch (error) {
	// Runtime/file/JSON errors can include paths, arbitrary text or credentials. Do not echo them.
	emit({
		stage: modes.includes(mode) ? mode : 'invalid',
		status: 'not_verified',
		reason: error instanceof InferenceCheckError ? error.reason : 'diagnostic_failed_check_prerequisites'
	});
	process.exitCode = 1;
}
