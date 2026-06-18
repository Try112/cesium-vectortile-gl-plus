import { ISource } from './ISource'

/**
 * @type {{[sourceType:string]:typeof ISource}}
 */
const Sources = {}

/**
 * 注册数据源类型，设置数据源类
 * @param {*} type
 * @param {*} sourceCls
 */
function registerSource(type, sourceCls) {
  Sources[type] = sourceCls
}

export { Sources, registerSource }
