const path = require('path');
const fs = require('fs');
const { gqlFolderPath, dictFolderPath } = require('../configs/paths');
const gql = require('graphql-tag');
const { visit, print: printGql } = require('graphql');
const { error, warn } = require('./logger');

module.exports = class GqlConfigService {

  static gqlSchema = {};

  get gqlFile() {
    return path.resolve(gqlFolderPath, `${this.gql}.gql`);
  }
  
  get dictFile() {
    return path.resolve(dictFolderPath, `${this.gql}.js`);
  }

  constructor({ gql, fields }) {
    this.gql = gql;
    this.fields = fields;
    const { dict, list } = require(this.dictFile);
    this.dict = dict;
    this.list = list;
  }

  cutGqlByDict() {
    const { query, dict, list } = this.expandGqlSchema();
    const exactDict = this.filterDictByFields(dict);
    const exactPaths = this.handleGjsonPath(Object.values(exactDict));
    const fields = [];
    const exactQuery = visit(query, {
      enter(node) {
        if (node.kind === 'Field') {
          fields.push(node.name.value);
          if (exactPaths.includes(fields.join('.'))) {
            fields.pop();
            return false;
          }
        }
      },
      leave (node) {
        if (node.kind === 'Field') {
          const queryPath = fields.join('.');
          fields.pop();
          if (!exactPaths.includes(queryPath) && !node.selectionSet) {
            return null;
          }
        }
        if (node.kind === 'SelectionSet') {
          if (node.selections.length === 0) {
            return null;
          }
        }
      }
    });

    return {
      query: printGql(exactQuery),
      list,
      dict: exactDict,
    };
  }

  // 配置gjson路径裁切gql失败时，可以在这增加gjson裁切逻辑
  handleGjsonPath(dictPaths) {
    const uniqDictPaths = new Set();
    for (let path of dictPaths) {
      // 处理 arr.0.first 路径 
      path = path.replace(/[.]\d+[.]/, '.');
      // 处理 children|@reverse 路径
      path = path.split('|@')[0];
      // 处理 arr.#.first 路径 
      path = path.split('.#')[0];
      uniqDictPaths.add(path);
    }
    return Array.from(uniqDictPaths);
  }

  filterDictByFields(dict) {
    if (this.fields === undefined) {
      return dict;
    }
    const exactDict = {}; 
    this.fields.forEach(field => {
      exactDict[field] = dict[field];
    });
    return exactDict;
  }

  expandGqlSchema() {
    const schema = GqlConfigService.gqlSchema[this.gql];
    if (schema != undefined) {
      return schema;
    }
    const { query, fragmentDict } = this.expandGql();
    const dict = this.expandDict(fragmentDict);
    const fullSchema = {
      query,
      list: this.list,
      dict,
    };
    GqlConfigService.gqlSchema[this.gql] = fullSchema; 
    return fullSchema;
  }

  expandGql() {
    const gqlSource = this.loadGqlFile();
    const fragmentDefinitions = this.expandGqlImports(gqlSource, gqlFolderPath);
    const documentNode = gql`${gqlSource}`;
    documentNode.definitions.push(...fragmentDefinitions);
    this.checkDocumentNode(documentNode);
    return this.spreadFragment(documentNode);
  }

  loadGqlFile() {
    return fs.readFileSync(this.gqlFile, 'utf-8');
  }

  expandGqlImports(gqlSource, currentPath, fragmentFileList = []) {
    const lines = gqlSource.split(/\r\n|\r|\n/);
    const fragmentDefinitions = [];
    lines.some((line) => {
      if (line[0] === '#' && line.slice(1).split(' ')[0] === 'import') {
        const fragmentRelativePath = line.slice(1).split(' ')[1].replace(/^['"]|['"]$/g, '');
        const fragmentPath = path.resolve(currentPath, fragmentRelativePath);
        if (!fs.existsSync(fragmentPath)) {
          throw new Error(error(`${fragmentPath} 文件不存在`));
        }
        if (fragmentFileList.indexOf(fragmentPath) === -1) {
          fragmentFileList.push(fragmentPath);
          const fragmentSource = fs.readFileSync(fragmentPath, 'utf-8');
          fragmentDefinitions.push(...gql`${fragmentSource}`.definitions, ...this.expandGqlImports(fragmentSource, path.dirname(fragmentPath), fragmentFileList));
        } else {
          warn('重复fragment文件导入, ${fragmentPath}');
        }
      }
      return (line.length !== 0 && line[0] !== '#');
    });
    return fragmentDefinitions;
  }

  checkDocumentNode(documentNode) {
    let queryOperateTimes = 0;
    for (const definition of documentNode.definitions) {
      if (definition.kind === 'OperationDefinition' && definition.operation === 'query') {
        queryOperateTimes++;
        if (queryOperateTimes >= 2) {
          break;
        }
      }
    }
    if (queryOperateTimes === 0 || queryOperateTimes >= 2) {
      throw new Error(error('需要定义一次query查询语句'));
    }
  }
  
  spreadFragment(documentNode) {
    const fragmentDict = {};
    let operateDefinitions = documentNode.definitions.filter(({ kind }) => kind === 'OperationDefinition')[0];
    
    const fragmentDefinitions = documentNode.definitions.filter(({ kind }) => kind === 'FragmentDefinition');
    const fragmentDefinitionMap = {};
    fragmentDefinitions.forEach(definition => {
      const fragmentName = definition.name.value;
      fragmentDefinitionMap[fragmentName] = definition;
    });
    const recursiveSpreadFragment = (definitions, dictPath = '') => {
      const fields = [];
      const node = visit(definitions, {
        enter(node) {
          if (node.kind === 'Field') {
            fields.push(node.name.value);
          }
          if (node.kind === 'FragmentSpread') {
            const fragmentName = node.name.value;
            if (fragmentDefinitionMap[fragmentName]) {
              if (!fragmentDict[fragmentName]) {
                fragmentDict[fragmentName] = dictPath + fields.join('.');
              }
              return recursiveSpreadFragment(fragmentDefinitionMap[fragmentName], fragmentDict[fragmentName] + '.');
            }
            throw new Error(error(`fragment ${fragmentName} 未定义`));
          }
        },
        leave (node) {
          if (node.kind === 'Field') {
            fields.pop();
          }
          if (node.kind === 'SelectionSet') {
            return {
              ...node,
              selections: node.selections.flat()
            };
          }
        }
      });
      return node.selectionSet.selections;
    };
    operateDefinitions.selectionSet.selections = recursiveSpreadFragment(operateDefinitions);
    return { query: operateDefinitions, fragmentDict };
  }

  expandDict(fragmentDict) {
    const dict = {};
    Object.keys(this.dict).forEach(field => {
      const dictPaths = this.dict[field].split('.');
      const fragmentName = dictPaths.shift();
      if (fragmentDict[fragmentName]) {
        dict[field] = fragmentDict[fragmentName] + '.' + dictPaths.join('.');
      } else {
        dict[field] =  this.dict[field];
      }
    });
    return dict;
  }
};
