// @flow

import React, {Component} from 'react';
import copy from 'copy-to-clipboard';
import {parse, print} from 'graphql';
import Prism from 'prismjs';

// TODO: not sure if we should include all snippets by default
import defaultSnippets from './snippets';

import type {OperationDefinitionNode, VariableDefinitionNode} from 'graphql';

function formatVariableName(name: string) {
  var uppercasePattern = /[A-Z]/g;

  return (
    name.charAt(0).toUpperCase() +
    name
      .slice(1)
      .replace(uppercasePattern, '_$&')
      .toUpperCase()
  );
}

const copyIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24">
    <path fill="none" d="M0 0h24v24H0V0z" />
    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm-1 4H8c-1.1 0-1.99.9-1.99 2L6 21c0 1.1.89 2 1.99 2H19c1.1 0 2-.9 2-2V11l-6-6zM8 21V7h6v5h5v9H8z" />
  </svg>
);

type Variables = {[key: string]: ?mixed};

type Options = {[id: string]: {label: string, value: string}};

type GenerateOperation = {
  query: string,
  name: string,
  displayName: string,
  type: string,
  variableName: string,
  variables: Variables,
  operation: OperationDefinitionNode,
};

export type GenerateOptions = {
  serverUrl: string,
  headers: {[name: string]: string},
  context: Object,
  operations: Array<GenerateOperation>,
  options: Options,
};

export type Snippet = {
  options: Array<{id: string, label: string, initial?: boolean}>,
  language: string,
  prismLanguage: ?string,
  name: string,
  generate: (options: GenerateOptions) => string,
};

const getInitialOptions = (snippet: Snippet): Options =>
  snippet.options.reduce((newOptions, option) => {
    newOptions[option.id] = {
      label: option.label,
      value: option.initial,
    };

    return newOptions;
  }, {});

const getOperations = (query: string): Array<OperationDefinitionNode> => {
  const operations = [];
  try {
    for (const def of parse(query).definitions) {
      if (
        def.kind === 'OperationDefinition' &&
        def.operation !== 'subscription'
      ) {
        operations.push(def);
      }
    }
    return operations;
  } catch (e) {
    return [];
  }
};

const getUsedVariables = (
  variables: Variables,
  operation: OperationDefinitionNode,
): Variables => {
  return (operation.variableDefinitions || []).reduce(
    (usedVariables, variable: VariableDefinitionNode) => {
      const variableName = variable.variable.name.value;
      if (variables[variableName]) {
        usedVariables[variableName] = variables[variableName];
      }

      return usedVariables;
    },
    {},
  );
};

const getOperationName = (operation: OperationDefinitionNode) =>
  operation.name ? operation.name.value : operation.operation;

const getOperationDisplayName = operation =>
  operation.name
    ? operation.name.value
    : '<Unnamed:' + operation.operation + '>';

/**
 * ToolbarMenu
 *
 * A menu style button to use within the Toolbar.
 * Copied from GraphiQL: https://github.com/graphql/graphiql/blob/272e2371fc7715217739efd7817ce6343cb4fbec/src/components/ToolbarMenu.js#L16-L80
 */
export class ToolbarMenu extends Component {
  constructor(props) {
    super(props);
    this.state = {visible: false};
  }

  componentWillUnmount() {
    this._release();
  }

  render() {
    const visible = this.state.visible;
    return (
      <a
        className="toolbar-menu toolbar-button"
        onClick={this.handleOpen.bind(this)}
        onMouseDown={e => e.preventDefault()}
        ref={node => {
          this._node = node;
        }}
        title={this.props.title}>
        {this.props.label}
        <svg width="14" height="8">
          <path fill="#666" d="M 5 1.5 L 14 1.5 L 9.5 7 z" />
        </svg>
        <ul className={'toolbar-menu-items' + (visible ? ' open' : '')}>
          {this.props.children}
        </ul>
      </a>
    );
  }

  _subscribe() {
    if (!this._listener) {
      this._listener = this.handleClick.bind(this);
      document.addEventListener('click', this._listener);
    }
  }

  _release() {
    if (this._listener) {
      document.removeEventListener('click', this._listener);
      this._listener = null;
    }
  }

  handleClick(e) {
    if (this._node !== e.target) {
      e.preventDefault();
      this.setState({visible: false});
      this._release();
    }
  }

  handleOpen = e => {
    e.preventDefault();
    this.setState({visible: true});
    this._subscribe();
  };
}

type Props = {|
  initialSnippet: Snippet,
  snippets: Array<Snippet>,
  query: string,
  theme: string,
  serverUrl: string,
  context: Object, // XXX: fix
  variables: Variables, // XXX: fix
  headers: {[name: string]: string},
  setOption?: (id: string, value: boolean) => void,
|};
type State = {|
  languages: Array<string>,
  showCopiedTooltip: boolean,
  options: Options,
  snippet: Snippet,
  query: string,
  operations?: $ReadOnlyArray<OperationDefinitionNode>,
|};

class CodeExporter extends Component<Props, State> {
  style: ?HTMLLinkElement;
  constructor(props: Props, context) {
    super(props, context);

    const {initialSnippet} = props;

    this.state = {
      languages: [],
      showCopiedTooltip: false,
      options: getInitialOptions(initialSnippet),
      snippet: initialSnippet,
      query: props.query,
    };
  }

  componentDidMount() {
    const style = document.createElement('link');
    style.setAttribute('rel', 'stylesheet');
    style.setAttribute(
      'href',
      'https://cdnjs.cloudflare.com/ajax/libs/prism/1.15.0/themes/' +
        this.props.theme +
        '.min.css',
    );

    document.head ? document.head.appendChild(style) : null;
    this.style = style;

    const langs: Array<string> = this.props.snippets.map(
      snippet => snippet.prismLanguage || snippet.language.toLowerCase(),
    );

    this.setState(prevState => ({
      languages: [...prevState.languages, ...langs],
    }));
  }

  componentWillUnmount() {
    this.style && this.style.remove();
  }

  static getDerivedStateFromProps(props: Props, state: State) {
    // for now we do not support subscriptions, might add those later
    const operations = getOperations(props.query).filter(
      op => op.operation !== 'subscription',
    );

    return {
      operations,
      query: props.query,
    };
  }

  setSnippet = (name: string) => {
    const snippet = this.props.snippets.find(
      snippet =>
        snippet.name === name &&
        snippet.language === this.state.snippet.language,
    );
    if (snippet) {
      this.setState({
        options: getInitialOptions(snippet),
        snippet,
      });
    }
  };

  setLanguage = (language: string) => {
    const snippet = this.props.snippets.find(
      snippet => snippet.language === language,
    );

    if (snippet) {
      this.setState({
        options: getInitialOptions(snippet),
        snippet,
      });
    }
  };

  defaultSetOption = (id: string, value: boolean) => {
    return this.setState({
      options: {
        ...this.state.options,
        [id]: {
          ...this.state.options[id],
          value: value,
        },
      },
    });
  };

  render() {
    const {
      serverUrl,
      snippets,
      context = {},
      variables = {},
      headers = {},
      setOption = this.defaultSetOption,
    } = this.props;
    const {snippet, options, operations, showCopiedTooltip} = this.state;

    if (!operations || operations.length === 0 || !snippet) {
      return null;
    }

    const {name, language, prismLanguage, generate} = snippet;

    const operationList = operations.map(
      (operation: OperationDefinitionNode) => ({
        query: print(operation),
        name: getOperationName(operation),
        displayName: getOperationDisplayName(operation),
        type: operation.operation,
        variableName: formatVariableName(getOperationName(operation)),
        variables: getUsedVariables(variables, operation),
        operation,
      }),
    );

    let codeSnippet = generate({
      serverUrl,
      headers,
      context,
      operations: operationList,
      options: Object.keys(options).reduce((flags, id) => {
        flags[id] = options[id].value;
        return flags;
      }, {}),
    });

    const rawSnippet = codeSnippet;
    // we use a try catch here because otherwise highlight might break the render
    try {
      const lang = prismLanguage || language.toLowerCase();
      codeSnippet = Prism.highlight(codeSnippet, Prism.languages[lang], lang);
    } catch (e) {}

    return (
      <div style={{minWidth: 410}}>
        <div
          style={{
            fontFamily:
              'system, -apple-system, San Francisco, Helvetica Neue, arial, sans-serif',
          }}>
          <div style={{padding: '12px 7px 8px'}}>
            <ToolbarMenu label={language} title="Language">
              {snippets
                .map(snippet => snippet.language)
                .filter(
                  (lang: string, index, arr) => arr.indexOf(lang) === index,
                )
                .sort((a: string, b: string) => a.localeCompare(b))
                .map((lang: string) => (
                  <li onClick={() => this.setLanguage(lang)}>{lang}</li>
                ))}
            </ToolbarMenu>
            <ToolbarMenu label={name} title="Mode">
              {snippets
                .filter(snippet => snippet.language === language)
                .map(snippet => snippet.name)
                .sort((a: string, b: string) =>
                  a.toLowerCase().localeCompare(b.toLowerCase()),
                )
                .map((snippetName: string) => (
                  <li onClick={() => this.setSnippet(snippetName)}>
                    {snippetName}
                  </li>
                ))}
            </ToolbarMenu>
          </div>
          {snippet.options.length > 0 ? (
            <div style={{padding: '0px 11px 10px'}}>
              <div
                style={{
                  fontWeight: 700,
                  color: 'rgb(177, 26, 4)',
                  fontVariant: 'small-caps',
                  textTransform: 'lowercase',
                }}>
                Options
              </div>
              {Object.keys(options)
                .sort((a: string, b: string) => a.localeCompare(b))
                .map(optionId => (
                  <div key={optionId}>
                    <input
                      id={optionId}
                      type="checkbox"
                      style={{position: 'relative', top: -1}}
                      checked={options[optionId].value}
                      onChange={() =>
                        setOption(optionId, !options[optionId].value)
                      }
                    />
                    <label for={optionId} style={{paddingLeft: 5}}>
                      {options[optionId].label}
                    </label>
                  </div>
                ))}
            </div>
          ) : (
            <div style={{minHeight: 8}} />
          )}
        </div>
        <button
          className={'toolbar-button'}
          style={{
            fontSize: '1.2em',
            padding: 0,
            position: 'absolute',
            left: 340,
            marginTop: -20,
            width: 40,
            height: 40,
            backgroundColor: 'white',
            borderRadius: 40,
            border: 'none',
          }}
          type="link"
          onClick={() => {
            copy(rawSnippet);
            this.setState({showCopiedTooltip: true}, () =>
              setTimeout(() => this.setState({showCopiedTooltip: false}), 450),
            );
          }}>
          <div
            style={{
              position: 'absolute',
              top: '-30px',
              left: '-15px',
              fontSize: 'small',
              padding: '6px 8px',
              color: '#fff',
              textAlign: 'left',
              textDecoration: 'none',
              wordWrap: 'break-word',
              backgroundColor: 'rgba(0,0,0,0.75)',
              borderRadius: '4px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              display: showCopiedTooltip ? 'block' : 'none',
            }}
            pointerEvents="none">
            Copied!
          </div>
          {copyIcon}
        </button>

        <pre
          style={{
            borderTop: '1px solid rgb(220, 220, 220)',
            padding: '15px 12px',
            margin: 0,
          }}>
          <code
            style={{
              fontFamily:
                'Dank Monk, Fira Code, Hack, Consolas, Inconsolata, Droid Sans Mono, Monaco, monospace',
              textRendering: 'optimizeLegibility',
              fontSize: 12,
            }}
            dangerouslySetInnerHTML={{
              __html: codeSnippet,
            }}
          />
          <div style={{minHeight: 10}} />
        </pre>
      </div>
    );
  }
}

class ErrorBoundary extends React.Component<*, {hasError: boolean}> {
  state = {hasError: false};

  componentDidCatch(error, info) {
    this.setState({hasError: true});
    console.error('Error in component', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div>
          Something went wrong on our side while generating a snippet, sorry
          about that!
        </div>
      );
    }
    return this.props.children;
  }
}

type WrapperProps = {
  query: string,
  serverUrl: string,
  variables: string,
  context: Object, // XXX: fix
  headers: {[name: string]: string},
  theme: string,
  hideCodeExporter: () => void,
  snippets: Array<Snippet>,
};

// we borrow class names from graphiql's CSS as the visual appearance is the same
// yet we might want to change that at some point in order to have a self-contained standalone
export default function CodeExporterWrapper({
  query,
  serverUrl,
  variables,
  context = {},
  headers = {},
  theme = 'prism',
  hideCodeExporter = () => {},
  snippets = defaultSnippets,
}: WrapperProps) {
  let jsonVariables: Variables = {};

  try {
    const parsedVariables = JSON.parse(variables);
    if (typeof parsedVariables === 'object') {
      jsonVariables = parsedVariables;
    }
  } catch (e) {}

  return (
    <div
      className="historyPaneWrap"
      style={{
        width: 440,
        minWidth: 440,
        zIndex: 7,
      }}>
      <div className="history-title-bar">
        <div className="history-title">Code Exporter</div>
        <div className="doc-explorer-rhs">
          <div className="docExplorerHide" onClick={hideCodeExporter}>
            {'\u2715'}
          </div>
        </div>
      </div>
      <div
        className="history-contents"
        style={{borderTop: '1px solid #d6d6d6'}}>
        <ErrorBoundary>
          <CodeExporter
            query={query}
            serverUrl={serverUrl}
            snippets={snippets}
            initialSnippet={snippets[0]}
            theme={theme}
            context={context}
            headers={headers}
            variables={jsonVariables}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
