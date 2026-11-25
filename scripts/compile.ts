import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import solc from 'solc';

interface SolcError {
  severity: 'error' | 'warning' | 'info';
  formattedMessage: string;
}

interface SolcOutput {
  errors?: SolcError[];
  contracts?: Record<
    string,
    Record<
      string,
      {
        abi: unknown[];
        evm: {
          bytecode: { object: string };
          deployedBytecode: { object: string };
        };
      }
    >
  >;
}

const root = process.cwd();
const sourceName = 'AgentReceiptRegistry.sol';
const sourcePath = path.join(root, 'contracts', sourceName);
const artifactDirectory = path.join(root, 'artifacts');
const artifactPath = path.join(artifactDirectory, 'AgentReceiptRegistry.json');

const source = readFileSync(sourcePath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    [sourceName]: { content: source },
  },
  settings: {
    evmVersion: 'paris',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
const errors = output.errors ?? [];
const fatalErrors = errors.filter((error) => error.severity === 'error');

for (const warning of errors.filter((error) => error.severity !== 'error')) {
  console.warn(warning.formattedMessage);
}

if (fatalErrors.length > 0 || !output.contracts) {
  for (const error of fatalErrors) {
    console.error(error.formattedMessage);
  }
  throw new Error('Solidity compilation failed');
}

const compiled = output.contracts[sourceName]?.AgentReceiptRegistry;

if (!compiled) {
  throw new Error(`Compiled contract not found: ${sourceName}:AgentReceiptRegistry`);
}

const artifact = {
  contractName: 'AgentReceiptRegistry',
  sourceName,
  compiler: solc.version(),
  abi: compiled.abi,
  bytecode: `0x${compiled.evm.bytecode.object}`,
  deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
};

mkdirSync(artifactDirectory, { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

console.log(
  `Compiled ${artifact.contractName} (${artifact.compiler}) -> ${path.relative(root, artifactPath)}`,
);
