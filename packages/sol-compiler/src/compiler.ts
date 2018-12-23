import { assert } from '@0x/assert';
import {
    FallthroughResolver,
    FSResolver,
    NameResolver,
    NPMResolver,
    RelativeFSResolver,
    Resolver,
    SpyResolver,
    URLResolver,
} from '@0x/sol-resolver';
import { logUtils } from '@0x/utils';
import { execSync } from 'child_process';
import * as chokidar from 'chokidar';
import { CompilerOptions, ContractArtifact, ContractVersionData, StandardOutput } from 'ethereum-types';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';
import * as pluralize from 'pluralize';
import * as semver from 'semver';
import solc = require('solc');

import { compilerOptionsSchema } from './schemas/compiler_options_schema';
import {
    addHexPrefixToContractBytecode,
    compileDockerAsync,
    compileSolcJSAsync,
    createDirIfDoesNotExistAsync,
    getContractArtifactIfExistsAsync,
    getDependencyNameToPackagePath,
    getSolcJSReleasesAsync,
    getSourcesWithDependencies,
    getSourceTreeHash,
    makeContractPathsRelative,
    parseSolidityVersionRange,
    printCompilationErrorsAndWarnings,
} from './utils/compiler';
import { constants } from './utils/constants';
import { fsWrapper } from './utils/fs_wrapper';
import { utils } from './utils/utils';

type TYPE_ALL_FILES_IDENTIFIER = '*';
const ALL_CONTRACTS_IDENTIFIER = '*';
const ALL_FILES_IDENTIFIER = '*';
const DEFAULT_CONTRACTS_DIR = path.resolve('contracts');
const DEFAULT_ARTIFACTS_DIR = path.resolve('artifacts');
const DEFAULT_USE_DOCKERISED_SOLC = false;
const DEFAULT_IS_OFFLINE_MODE = false;
// Solc compiler settings cannot be configured from the commandline.
// If you need this configured, please create a `compiler.json` config file
// with your desired configurations.
const DEFAULT_COMPILER_SETTINGS: solc.CompilerSettings = {
    optimizer: {
        enabled: false,
    },
    outputSelection: {
        [ALL_FILES_IDENTIFIER]: {
            [ALL_CONTRACTS_IDENTIFIER]: ['abi', 'evm.bytecode.object'],
        },
    },
};
const CONFIG_FILE = 'compiler.json';

interface VersionToInputs {
    [solcVersion: string]: {
        standardInput: solc.StandardInput;
        contractsToCompile: string[];
    };
}

interface ContractPathToData {
    [contractPath: string]: ContractData;
}

interface ContractData {
    currentArtifactIfExists: ContractArtifact | void;
    sourceTreeHashHex: string;
    contractName: string;
}

/**
 * The Compiler facilitates compiling Solidity smart contracts and saves the results
 * to artifact files.
 */
export class Compiler {
    private readonly _resolver: Resolver;
    private readonly _nameResolver: NameResolver;
    private readonly _contractsDir: string;
    private readonly _compilerSettings: solc.CompilerSettings;
    private readonly _artifactsDir: string;
    private readonly _solcVersionIfExists: string | undefined;
    private readonly _specifiedContracts: string[] | TYPE_ALL_FILES_IDENTIFIER;
    private readonly _useDockerisedSolc: boolean;
    private readonly _isOfflineMode: boolean;
    /**
     * Instantiates a new instance of the Compiler class.
     * @param opts Optional compiler options
     * @return An instance of the Compiler class.
     */
    constructor(opts?: CompilerOptions) {
        const passedOpts = opts || {};
        assert.doesConformToSchema('opts', passedOpts, compilerOptionsSchema);
        // TODO: Look for config file in parent directories if not found in current directory
        const config: CompilerOptions = fs.existsSync(CONFIG_FILE)
            ? JSON.parse(fs.readFileSync(CONFIG_FILE).toString())
            : {};
        assert.doesConformToSchema('compiler.json', config, compilerOptionsSchema);
        this._contractsDir = path.resolve(passedOpts.contractsDir || config.contractsDir || DEFAULT_CONTRACTS_DIR);
        this._solcVersionIfExists = passedOpts.solcVersion || config.solcVersion;
        this._compilerSettings = {
            ...DEFAULT_COMPILER_SETTINGS,
            ...config.compilerSettings,
            ...passedOpts.compilerSettings,
        };
        this._artifactsDir = passedOpts.artifactsDir || config.artifactsDir || DEFAULT_ARTIFACTS_DIR;
        this._specifiedContracts = passedOpts.contracts || config.contracts || ALL_CONTRACTS_IDENTIFIER;
        this._useDockerisedSolc =
            passedOpts.useDockerisedSolc || config.useDockerisedSolc || DEFAULT_USE_DOCKERISED_SOLC;
        this._isOfflineMode = passedOpts.isOfflineMode || config.isOfflineMode || DEFAULT_IS_OFFLINE_MODE;
        this._nameResolver = new NameResolver(this._contractsDir);
        const resolver = new FallthroughResolver();
        resolver.appendResolver(new URLResolver());
        resolver.appendResolver(new NPMResolver(this._contractsDir));
        resolver.appendResolver(new RelativeFSResolver(this._contractsDir));
        resolver.appendResolver(new FSResolver());
        resolver.appendResolver(this._nameResolver);
        this._resolver = resolver;
    }
    /**
     * Compiles selected Solidity files found in `contractsDir` and writes JSON artifacts to `artifactsDir`.
     */
    public async compileAsync(): Promise<void> {
        await createDirIfDoesNotExistAsync(this._artifactsDir);
        await createDirIfDoesNotExistAsync(constants.SOLC_BIN_DIR);
        await this._compileContractsAsync(this._getContractNamesToCompile(), true);
    }

    public async concatSourceAsync(): Promise<void> {
        const contractNames = this._getContractNamesToCompile();
        for (const contractName of contractNames) {
            // const sourceCode = this._getConcatenatedSourceCode(contractName);
            console.log(contractName);
            // console.log(sourceCode);
        }
    }
    /**
     * Compiles Solidity files specified during instantiation, and returns the
     * compiler output given by solc.  Return value is an array of outputs:
     * Solidity modules are batched together by version required, and each
     * element of the returned array corresponds to a compiler version, and
     * each element contains the output for all of the modules compiled with
     * that version.
     */
    public async getCompilerOutputsAsync(): Promise<StandardOutput[]> {
        const promisedOutputs = this._compileContractsAsync(this._getContractNamesToCompile(), false);
        return promisedOutputs;
    }
    public async watchAsync(): Promise<void> {
        console.clear(); // tslint:disable-line:no-console
        logUtils.logWithTime('Starting compilation in watch mode...');
        const MATCH_NOTHING_REGEX = '^$';
        const IGNORE_DOT_FILES_REGEX = /(^|[\/\\])\../;
        // Initially we watch nothing. We'll add the paths later.
        const watcher = chokidar.watch(MATCH_NOTHING_REGEX, { ignored: IGNORE_DOT_FILES_REGEX });
        const onFileChangedAsync = async () => {
            watcher.unwatch('*'); // Stop watching
            try {
                await this.compileAsync();
                logUtils.logWithTime('Found 0 errors. Watching for file changes.');
            } catch (err) {
                if (err.typeName === 'CompilationError') {
                    logUtils.logWithTime(
                        `Found ${err.errorsCount} ${pluralize('error', err.errorsCount)}. Watching for file changes.`,
                    );
                } else {
                    logUtils.logWithTime('Found errors. Watching for file changes.');
                }
            }

            const pathsToWatch = this._getPathsToWatch();
            watcher.add(pathsToWatch);
        };
        await onFileChangedAsync();
        watcher.on('change', (changedFilePath: string) => {
            console.clear(); // tslint:disable-line:no-console
            logUtils.logWithTime('File change detected. Starting incremental compilation...');
            // NOTE: We can't await it here because that's a callback.
            // Instead we stop watching inside of it and start it again when we're finished.
            onFileChangedAsync(); // tslint:disable-line no-floating-promises
        });
    }
    private _getPathsToWatch(): string[] {
        const contractNames = this._getContractNamesToCompile();
        const spyResolver = new SpyResolver(this._resolver);
        for (const contractName of contractNames) {
            const contractSource = spyResolver.resolve(contractName);
            // NOTE: We ignore the return value here. We don't want to compute the source tree hash.
            // We just want to call a SpyResolver on each contracts and it's dependencies and
            // this is a convenient way to reuse the existing code that does that.
            // We can then get all the relevant paths from the `spyResolver` below.
            getSourceTreeHash(spyResolver, contractSource.path);
        }
        const pathsToWatch = _.uniq(spyResolver.resolvedContractSources.map(cs => cs.absolutePath));
        return pathsToWatch;
    }
    private _getContractNamesToCompile(): string[] {
        let contractNamesToCompile;
        if (this._specifiedContracts === ALL_CONTRACTS_IDENTIFIER) {
            const allContracts = this._nameResolver.getAll();
            contractNamesToCompile = _.map(allContracts, contractSource =>
                path.basename(contractSource.path, constants.SOLIDITY_FILE_EXTENSION),
            );
        } else {
            return this._specifiedContracts;
        }
        return contractNamesToCompile;
    }
    /**
     * Compiles contracts, and, if `shouldPersist` is true, saves artifacts to artifactsDir.
     * @param fileName Name of contract with '.sol' extension.
     * @return an array of compiler outputs, where each element corresponds to a different version of solc-js.
     */
    private async _compileContractsAsync(contractNames: string[], shouldPersist: boolean): Promise<StandardOutput[]> {
        // batch input contracts together based on the version of the compiler that they require.
        const versionToInputs: VersionToInputs = {};

        // map contract paths to data about them for later verification and persistence
        const contractPathToData: ContractPathToData = {};

        const solcJSReleases = await getSolcJSReleasesAsync(this._isOfflineMode);
        const resolvedContractSources = [];
        for (const contractName of contractNames) {
            const spyResolver = new SpyResolver(this._resolver);
            const contractSource = spyResolver.resolve(contractName);
            const sourceTreeHashHex = getSourceTreeHash(spyResolver, contractSource.path).toString('hex');
            const contractData = {
                contractName: path.basename(contractName, constants.SOLIDITY_FILE_EXTENSION),
                currentArtifactIfExists: await getContractArtifactIfExistsAsync(this._artifactsDir, contractName),
                sourceTreeHashHex: `0x${sourceTreeHashHex}`,
            };
            if (!this._shouldCompile(contractData)) {
                continue;
            }
            contractPathToData[contractSource.path] = contractData;
            const solcVersion = _.isUndefined(this._solcVersionIfExists)
                ? semver.maxSatisfying(_.keys(solcJSReleases), parseSolidityVersionRange(contractSource.source))
                : this._solcVersionIfExists;
            if (_.isNull(solcVersion)) {
                throw new Error(
                    `Couldn't find any solidity version satisfying the constraint ${parseSolidityVersionRange(
                        contractSource.source,
                    )}`,
                );
            }
            const isFirstContractWithThisVersion = _.isUndefined(versionToInputs[solcVersion]);
            if (isFirstContractWithThisVersion) {
                versionToInputs[solcVersion] = {
                    standardInput: {
                        language: 'Solidity',
                        sources: {},
                        settings: this._compilerSettings,
                    },
                    contractsToCompile: [],
                };
            }
            // add input to the right version batch
            for (const resolvedContractSource of spyResolver.resolvedContractSources) {
                versionToInputs[solcVersion].standardInput.sources[resolvedContractSource.absolutePath] = {
                    content: resolvedContractSource.source,
                };
            }
            resolvedContractSources.push(...spyResolver.resolvedContractSources);
            versionToInputs[solcVersion].contractsToCompile.push(contractSource.path);
        }

        const dependencyNameToPath = getDependencyNameToPackagePath(resolvedContractSources);

        const compilerOutputs: StandardOutput[] = [];
        for (const solcVersion of _.keys(versionToInputs)) {
            const input = versionToInputs[solcVersion];
            logUtils.warn(
                `Compiling ${input.contractsToCompile.length} contracts (${
                    input.contractsToCompile
                }) with Solidity v${solcVersion}...`,
            );
            let compilerOutput;
            let fullSolcVersion;
            input.standardInput.settings.remappings = _.map(
                dependencyNameToPath,
                (dependencyPackagePath: string, dependencyName: string) => `${dependencyName}=${dependencyPackagePath}`,
            );
            if (this._useDockerisedSolc) {
                const dockerCommand = `docker run ethereum/solc:${solcVersion} --version`;
                const versionCommandOutput = execSync(dockerCommand).toString();
                const versionCommandOutputParts = versionCommandOutput.split(' ');
                fullSolcVersion = versionCommandOutputParts[versionCommandOutputParts.length - 1].trim();
                compilerOutput = await compileDockerAsync(solcVersion, input.standardInput);
            } else {
                fullSolcVersion = solcJSReleases[solcVersion];
                compilerOutput = await compileSolcJSAsync(solcVersion, input.standardInput, this._isOfflineMode);
            }
            if (!_.isUndefined(compilerOutput.errors)) {
                printCompilationErrorsAndWarnings(compilerOutput.errors);
            }
            compilerOutput.sources = makeContractPathsRelative(
                compilerOutput.sources,
                this._contractsDir,
                dependencyNameToPath,
            );
            compilerOutput.contracts = makeContractPathsRelative(
                compilerOutput.contracts,
                this._contractsDir,
                dependencyNameToPath,
            );

            for (const contractPath of input.contractsToCompile) {
                const contractName = contractPathToData[contractPath].contractName;

                const compiledContract = compilerOutput.contracts[contractPath][contractName];
                if (_.isUndefined(compiledContract)) {
                    throw new Error(
                        `Contract ${contractName} not found in ${contractPath}. Please make sure your contract has the same name as it's file name`,
                    );
                }

                addHexPrefixToContractBytecode(compiledContract);

                if (shouldPersist) {
                    await this._persistCompiledContractAsync(
                        contractPath,
                        contractPathToData[contractPath].currentArtifactIfExists,
                        contractPathToData[contractPath].sourceTreeHashHex,
                        contractName,
                        fullSolcVersion,
                        compilerOutput,
                    );
                }
            }

            compilerOutputs.push(compilerOutput);
        }

        return compilerOutputs;
    }
    private _shouldCompile(contractData: ContractData): boolean {
        if (_.isUndefined(contractData.currentArtifactIfExists)) {
            return true;
        } else {
            const currentArtifact = contractData.currentArtifactIfExists as ContractArtifact;
            const isUserOnLatestVersion = currentArtifact.schemaVersion === constants.LATEST_ARTIFACT_VERSION;
            const didCompilerSettingsChange = !_.isEqual(
                _.omit(currentArtifact.compiler.settings, 'remappings'),
                _.omit(this._compilerSettings, 'remappings'),
            );
            const didSourceChange = currentArtifact.sourceTreeHashHex !== contractData.sourceTreeHashHex;
            return !isUserOnLatestVersion || didCompilerSettingsChange || didSourceChange;
        }
    }
    private async _persistCompiledContractAsync(
        contractPath: string,
        currentArtifactIfExists: ContractArtifact | void,
        sourceTreeHashHex: string,
        contractName: string,
        fullSolcVersion: string,
        compilerOutput: solc.StandardOutput,
    ): Promise<void> {
        const compiledContract = compilerOutput.contracts[contractPath][contractName];

        // need to gather sourceCodes for this artifact, but compilerOutput.sources (the list of contract modules)
        // contains listings for every contract compiled during the compiler invocation that compiled the contract
        // to be persisted, which could include many that are irrelevant to the contract at hand.  So, gather up only
        // the relevant sources:
        const { sourceCodes, sources } = getSourcesWithDependencies(
            this._resolver,
            contractPath,
            compilerOutput.sources,
        );

        const contractVersion: ContractVersionData = {
            compilerOutput: compiledContract,
            sources,
            sourceCodes,
            sourceTreeHashHex,
            compiler: {
                name: 'solc',
                version: fullSolcVersion,
                settings: this._compilerSettings,
            },
        };

        let newArtifact: ContractArtifact;
        if (!_.isUndefined(currentArtifactIfExists)) {
            const currentArtifact = currentArtifactIfExists as ContractArtifact;
            newArtifact = {
                ...currentArtifact,
                ...contractVersion,
            };
        } else {
            newArtifact = {
                schemaVersion: constants.LATEST_ARTIFACT_VERSION,
                contractName,
                ...contractVersion,
                networks: {},
            };
        }

        const artifactString = utils.stringifyWithFormatting(newArtifact);
        const currentArtifactPath = `${this._artifactsDir}/${contractName}.json`;
        await fsWrapper.writeFileAsync(currentArtifactPath, artifactString);
        logUtils.warn(`${contractName} artifact saved!`);
    }
    // /**
    //  * For the given @param contractPath, populates JSON objects to be used in the ContractVersionData interface's
    //  * properties `sources` (source code file names mapped to ID numbers) and `sourceCodes` (source code content of
    //  * contracts) for that contract.  The source code pointed to by contractPath is read and parsed directly (via
    //  * `this._resolver.resolve().source`), as are its imports, recursively.  The ID numbers for @return `sources` are
    //  * taken from the corresponding ID's in @param fullSources, and the content for @return sourceCodes is read from
    //  * disk (via the aforementioned `resolver.source`).
    //  */
    // private _getSourcesWithDependencies(
    //     contractPath: string,
    //     fullSources: { [sourceName: string]: { id: number } },
    // ): { sourceCodes: { [sourceName: string]: string }; sources: { [sourceName: string]: { id: number } } } {
    //     const sources = { [contractPath]: { id: fullSources[contractPath].id } };
    //     const sourceCodes = { [contractPath]: this._resolver.resolve(contractPath).source };
    //     this._recursivelyGatherDependencySources(
    //         contractPath,
    //         sourceCodes[contractPath],
    //         fullSources,
    //         sources,
    //         sourceCodes,
    //     );
    //     return { sourceCodes, sources };
    // }
    // private _recursivelyGatherDependencySources(
    //     contractPath: string,
    //     contractSource: string,
    //     fullSources: { [sourceName: string]: { id: number } },
    //     sourcesToAppendTo: { [sourceName: string]: { id: number } },
    //     sourceCodesToAppendTo: { [sourceName: string]: string },
    // ): void {
    //     const importStatementMatches = contractSource.match(/\nimport[^;]*;/g);
    //     if (importStatementMatches === null) {
    //         return;
    //     }
    //     for (const importStatementMatch of importStatementMatches) {
    //         const importPathMatches = importStatementMatch.match(/\"([^\"]*)\"/);
    //         if (importPathMatches === null || importPathMatches.length === 0) {
    //             continue;
    //         }

    //         let importPath = importPathMatches[1];
    //         // HACK(ablrow): We have, e.g.:
    //         //
    //         //      importPath   = "../../utils/LibBytes/LibBytes.sol"
    //         //      contractPath = "2.0.0/protocol/AssetProxyOwner/AssetProxyOwner.sol"
    //         //
    //         // Resolver doesn't understand "../" so we want to pass
    //         // "2.0.0/utils/LibBytes/LibBytes.sol" to resolver.
    //         //
    //         // This hack involves using path.resolve. But path.resolve returns
    //         // absolute directories by default. We trick it into thinking that
    //         // contractPath is a root directory by prepending a '/' and then
    //         // removing the '/' the end.
    //         //
    //         //      path.resolve("/a/b/c", ""../../d/e") === "/a/d/e"
    //         //
    //         const lastPathSeparatorPos = contractPath.lastIndexOf('/');
    //         const contractFolder = lastPathSeparatorPos === -1 ? '' : contractPath.slice(0, lastPathSeparatorPos + 1);
    //         if (importPath.startsWith('.')) {
    //             /**
    //              * Some imports path are relative ("../Token.sol", "./Wallet.sol")
    //              * while others are absolute ("Token.sol", "@0x/contracts/Wallet.sol")
    //              * And we need to append the base path for relative imports.
    //              */
    //             importPath = path.resolve(`/${contractFolder}`, importPath).replace('/', '');
    //         }

    //         if (_.isUndefined(sourcesToAppendTo[importPath])) {
    //             sourcesToAppendTo[importPath] = { id: fullSources[importPath].id };
    //             sourceCodesToAppendTo[importPath] = this._resolver.resolve(importPath).source;

    //             this._recursivelyGatherDependencySources(
    //                 importPath,
    //                 this._resolver.resolve(importPath).source,
    //                 fullSources,
    //                 sourcesToAppendTo,
    //                 sourceCodesToAppendTo,
    //             );
    //         }
    //     }
    // }
    // private _compile(solcInstance: solc.SolcInstance, standardInput: solc.StandardInput): solc.StandardOutput {
    //     const compiled: solc.StandardOutput = JSON.parse(
    //         solcInstance.compileStandardWrapper(JSON.stringify(standardInput), importPath => {
    //             const sourceCodeIfExists = this._resolver.resolve(importPath);
    //             return { contents: sourceCodeIfExists.source };
    //         }),
    //     );
    //     if (!_.isUndefined(compiled.errors)) {
    //         const SOLIDITY_WARNING = 'warning';
    //         const errors = _.filter(compiled.errors, entry => entry.severity !== SOLIDITY_WARNING);
    //         const warnings = _.filter(compiled.errors, entry => entry.severity === SOLIDITY_WARNING);
    //         if (!_.isEmpty(errors)) {
    //             errors.forEach(error => {
    //                 const normalizedErrMsg = getNormalizedErrMsg(error.formattedMessage || error.message);
    //                 logUtils.warn(chalk.red(normalizedErrMsg));
    //             });
    //             throw new Error('Compilation errors encountered');
    //         } else {
    //             warnings.forEach(warning => {
    //                 const normalizedWarningMsg = getNormalizedErrMsg(warning.formattedMessage || warning.message);
    //                 logUtils.warn(chalk.yellow(normalizedWarningMsg));
    //             });
    //         }
    //     }
    //     return compiled;
    // }

    // private _getConcatenatedSourceCode(importPath: string): string {
    //     const seen: string[] = [];
    //     this._findSourceDependencyTree(importPath, seen);
    //     const sources = [];
    //     for (const file of seen) {
    //         const contractSource = this._resolver.resolve(file);
    //         sources.push(contractSource.source);
    //     }
    //     const concatenatedSourceCode = sources.join('\n');
    //     return concatenatedSourceCode;
    // }

    // private _findSourceDependencyTree(importPath: string, seen: string[] = []): any {
    //     const contractSource = this._resolver.resolve(importPath);
    //     const contractDependencies = parseDependencies(contractSource);
    //     if (seen.indexOf(contractSource.path) !== -1) {
    //         return undefined;
    //     }
    //     let dependencyTree: any;
    //     if (contractDependencies.length === 0) {
    //         dependencyTree = {
    //             [contractSource.path]: {},
    //         };
    //     } else {
    //         const dependencySourceTree = _.reduce(
    //             contractDependencies,
    //             (prev, curr) => {
    //                 return { ...prev, ...this._findSourceDependencyTree(curr, seen) };
    //             },
    //             {},
    //         );
    //         dependencyTree = {
    //             [contractSource.path]: dependencySourceTree,
    //         };
    //     }
    //     seen.push(contractSource.path);
    //     return dependencyTree;
    // }
    // /**
    //  * Gets the source tree hash for a file and its dependencies.
    //  * @param fileName Name of contract file.
    //  */
    // private _getSourceTreeHash(importPath: string): Buffer {
    //     const contractSource = this._resolver.resolve(importPath);
    //     const dependencies = parseDependencies(contractSource);
    //     const sourceHash = ethUtil.sha3(contractSource.source);
    //     if (dependencies.length === 0) {
    //         return sourceHash;
    //     } else {
    //         const dependencySourceTreeHashes = _.map(dependencies, (dependency: string) =>
    //             this._getSourceTreeHash(dependency),
    //         );
    //         const sourceTreeHashesBuffer = Buffer.concat([sourceHash, ...dependencySourceTreeHashes]);
    //         const sourceTreeHash = ethUtil.sha3(sourceTreeHashesBuffer);
    //         return sourceTreeHash;
    //     }
    // }
}
