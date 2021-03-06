'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var Axios = _interopDefault(require('axios'));
var jmespath = _interopDefault(require('jmespath'));
var nodeHtmlParser = require('node-html-parser');
var qs = require('qs');

function isArray(value) {
    return value instanceof Array;
}
function isObject(value) {
    return value instanceof Object && !(value instanceof Array);
}
/**
 * 深度遍历对象
 * @param target 目标对象
 * @param callback 处理每个元素的回调函数
 * @param path 当前元素的位置
 */
function deepEach(target, callback = (value) => value, path = "") {
    let _target = null;
    if (isObject(target)) {
        const keys = Object.keys(target);
        _target = {};
        keys.forEach(key => {
            _target[key] = deepEach(target[key], callback, path.length === 0 ? key : path + "." + key);
        });
    }
    else if (isArray(target)) {
        _target = [];
        target.forEach((item, index) => {
            _target[index] = deepEach(item, callback, path + `[${index}]`);
        });
    }
    else {
        return callback(target, path);
    }
    return _target;
}
function sleep(interval = 100) {
    return new Promise(resolve => setTimeout(resolve, interval));
}

/**
 * 指令类
 * 指令格式：{{v-<指令名>[=<参数>]}}
 */
class Directive {
    constructor(init) {
        Object.assign(this, init);
    }
    deepTransform(target, refer = this.refer) {
        const _v = [];
        const _target = deepEach(target, (value, path) => {
            if (value.search(/\{\{.*\[\*\].*\}\}/gm) !== -1) {
                // console.log(value, path);
                _v.push(path);
            }
            return this.transform(value, refer);
        });
        _target['_v'] = _v;
        return _target;
    }
    /**
     * 执行字符串内的指令函数，并且将指令替换为值
     * @param value 一个字符串
     * @param refer 参考对象
     */
    transform(value, refer) {
        if (typeof value !== 'string') {
            return value;
        }
        const matchs = this.parser(value);
        if (matchs.length === 0) {
            return value;
        }
        //指令和值的映射对象
        const map = matchs.reduce((perv, curr) => {
            const res = this[curr.directive](refer, curr.argStr);
            perv[curr.source] = res instanceof Array ? res : [res];
            return perv;
        }, {});
        //获取元素最多的指令结果
        const keys = Object.keys(map);
        let maxKey = keys[0];
        keys.forEach(key => {
            if (map[key].length > map[maxKey].length) {
                maxKey = key;
            }
        });
        const maxLen = map[maxKey] ? map[maxKey].length : 0;
        //将不同长度的元素对齐
        keys.forEach(key => {
            const item = map[key];
            const oldLen = item.length;
            const lastItem = item[oldLen - 1];
            item.length = maxLen;
            item.fill(lastItem, oldLen, maxLen);
        });
        //替换指令为值
        const vals = [];
        for (let i = 0; i < maxLen; i++) {
            let val = value;
            keys.forEach((key) => {
                val = val.replace(key, map[key][i]);
            });
            vals.push(val);
        }
        return vals.length === 1 ? vals[0] : vals;
    }
    parser(value) {
        const directiveMatch = value.match(/\{\{v-.+?\}\}/gm);
        if (directiveMatch === null) {
            return [];
        }
        return directiveMatch.map((curr) => {
            const str = curr.replace(/\{|\}/gm, '');
            const directive = str.substring(0, str.indexOf("="));
            const argStr = str.substring(str.indexOf("=") + 1);
            return { source: curr, directive, argStr };
        });
    }
    /**
     * 获取当前实例
     * @param key JSON查询字符串
     */
    ['v-refer'](refer, key) {
        return jmespath.search(refer, key);
    }
    /**
     * 根据key返回状态的值
     * @param key JSON查询字符串
     */
    ['v-state'](refer, key) {
        return jmespath.search(refer.state, key);
    }
    /**
     * 根据key返回状态的值
     * @param key JSON查询字符串
     */
    ['v-meta'](refer, key) {
        return jmespath.search(refer.meta, key);
    }
    /**
     * 查询上一个step的对象
     * @param key JSON查询字符串
     */
    ['v-prev'](refer, key) {
        return jmespath.search(refer.steps[refer.state.current - 1], key);
    }
    /**
     * 查询上一个step的对象的rawResults
     * @param key JSON查询字符串
     */
    ['v-prev-resu-raw'](refer, key) {
        return jmespath.search(refer.steps[refer.state.current - 1].rawResults, key);
    }
    /**
     * 查询上一个step的对象的results
     * @param key JSON查询字符串
     */
    ['v-prev-resu'](refer, key) {
        return jmespath.search(refer.steps[refer.state.current - 1].results, key);
    }
    /**
     * 查询上一个step的对象的response
     * @param key JSON查询字符串
     */
    ['v-prev-resp'](refer, key) {
        return jmespath.search(refer.steps[refer.state.current - 1].responses, key);
    }
    /**
     * 查询当前step的对象
     * @param key JSON查询字符串
     */
    ['v-curr'](refer, key) {
        return jmespath.search(refer.steps[refer.state.current], key);
    }
    /**
     * 获取当前的response
     * @param key JSON查询字符串
     */
    ['v-resp'](refer, key) {
        return jmespath.search(refer.response, key);
    }
    /**
     * 获取当前的response
     * @param key JSON查询字符串
     */
    ['v-resp-html'](refer, key) {
        const [htmlSelector, jsonSelector] = key.split('|');
        const dom = nodeHtmlParser.parse(refer.response.data);
        const result = dom.querySelectorAll(htmlSelector);
        return jmespath.search(result, jsonSelector);
    }
}

class State {
    constructor() {
        this.current = 0; //当前步的下标
        this.startTime = new Date(); //开始时间
        this.endTime = null; //结束时间
    }
}

class Meta {
    constructor(init) {
        this.name = ''; // 名称
        this.version = 0; // 版本
        Object.assign(this, init);
    }
}

class Option {
    constructor(init) {
        this.delay = 100; //延迟
        this.errRetry = 0; //错误重试次数
        this.timeout = 1000 * 10; //请求超时时间
        Object.assign(this, init);
    }
}

(function (MethodType) {
    MethodType["POST"] = "post";
    MethodType["GET"] = "get";
})(exports.MethodType || (exports.MethodType = {}));
(function (DataType) {
    DataType["JSON"] = "json";
    DataType["FORMDATA"] = "formdata";
})(exports.DataType || (exports.DataType = {}));
class Step {
    constructor(init) {
        this.key = 'default'; // 这个会在执行merage方法的时候最为key
        this.url = ''; //请求url
        this.params = {}; //请求GET参数
        this.data = {}; //post参数
        this.header = {}; // 头
        this.dataType = exports.DataType.JSON; // Data数据类型
        this.method = exports.MethodType.GET; // 请求方式
        this.state = new State(); // 状态
        this.resultModel = {}; // 结果模型
        this.requests = []; // 请求集合
        this.responses = []; //相应集合
        this.results = []; // 最终结果
        this.rawResults = []; //原始结果
        this.isMergeResult = true; // 是否合并结果
        this.prevStep = null; //上一步
        Object.assign(this, init);
    }
    /**
     * 批量创建步
     * @param steps 多个步
     */
    static batchCreate(steps) {
        return steps.map(item => new Step(item));
    }
}

(function (EventList) {
    EventList["START"] = "start";
    EventList["GO_BEFORE"] = "go:before";
    EventList["GO_AFTER"] = "go:after";
    EventList["END"] = "end";
    EventList["REQUEST_ERR"] = "request:err";
    EventList["REQUEST"] = "request";
    EventList["RESPONSE"] = "response";
})(exports.EventList || (exports.EventList = {}));
class Event {
    constructor() {
        this.callbacks = {};
    }
    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }
    emit(event, ...args) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => callback(...args));
        }
    }
}

class HttpCrawler {
    constructor(config) {
        this.state = new State();
        this.steps = [];
        this.event = new Event;
        this.directive = new Directive(config.directive);
        this.meta = new Meta(config.meta);
        this.option = new Option(config.option);
        this.steps = Step.batchCreate(config.steps);
        this.directive.refer = this;
    }
    /**
     * 完成所有步
     * @param meta 元数据
     */
    async run(meta) {
        Object.assign(this.meta, meta);
        this.event.emit(exports.EventList.START, this);
        for (let i = this.state.current; i < this.steps.length; i++) {
            await this.go();
        }
        const finalResults = this.mergeResult();
        this.event.emit(exports.EventList.END, finalResults, this);
        return finalResults;
    }
    /**
     * 走一步
     * @param meta 元数据，可以通过指令来访问
     */
    async go(meta) {
        Object.assign(this.meta, meta);
        /**
         * 1、将指令转化为值
         * 2、将多个值分离填充为多个对象
         * 3、整理出必要的属性，组成request对象
         * 4、发送所有的requests对象，并且将结果放到responses
         * 5、通过resultMode处理responses里的对象，并且存放到results里
         */
        const currentStep = this.$step;
        this.event.emit(exports.EventList.GO_BEFORE, currentStep, this);
        const untreatedRequest = {
            method: currentStep.method,
            dataType: currentStep.dataType
        };
        untreatedRequest.url = deepEach(currentStep.url);
        untreatedRequest.params = deepEach(currentStep.params);
        untreatedRequest.data = deepEach(currentStep.data);
        untreatedRequest.header = deepEach(currentStep.header);
        const transformRequest = this.directive.deepTransform(untreatedRequest);
        currentStep.requests = this.splitFull(transformRequest);
        for (let i = 0; i < currentStep.requests.length; i++) {
            //将所有请求挨个发送
            const req = currentStep.requests[i];
            let errRetry = this.option.errRetry;
            let isRetry = false;
            do {
                try {
                    currentStep.state.startTime = new Date();
                    currentStep.responses[i] = await this.request(req);
                    this.event.emit(exports.EventList.RESPONSE, currentStep.responses[i], this);
                    currentStep.state.endTime = new Date();
                    isRetry = false;
                }
                catch (error) {
                    errRetry--;
                    isRetry = true;
                    this.event.emit(exports.EventList.REQUEST_ERR, error, this);
                }
            } while (isRetry && errRetry >= 0);
            await sleep(this.option.delay);
        }
        for (let i = 0; i < currentStep.responses.length; i++) {
            // 将所有结果挨个处理
            const response = currentStep.responses[i];
            const deepTransformValues = this.directive.deepTransform(currentStep.resultModel, { ...this, response });
            currentStep.rawResults[i] = this.splitFull(deepTransformValues);
        }
        currentStep.results = currentStep.rawResults;
        if (currentStep.isMergeResult) {
            //开始和处理后的结果
            currentStep.results = currentStep.rawResults.reduce((prev, curr) => {
                if (isArray(curr)) {
                    prev.push(...curr);
                }
                else {
                    prev.push(curr);
                }
                return prev;
            }, []);
        }
        this.state.current++;
        this.state.endTime = new Date();
        if ((this.state.current) < this.steps.length) {
            currentStep.prevStep = currentStep;
        }
        this.event.emit(exports.EventList.GO_AFTER, currentStep, this);
        return currentStep.results;
    }
    /**
     * 发送请求
     * @param req 进行网络请求
     */
    request(req) {
        const config = {};
        config.url = req.url;
        config.headers = req.header;
        config.data = req.data;
        config.params = req.params;
        config.method = req.method;
        config.timeout = this.option.timeout;
        if (req.method === exports.MethodType.POST && req.dataType === exports.DataType.FORMDATA) {
            config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            config.data = qs.stringify(config.data);
        }
        else if (req.method === exports.MethodType.POST && req.dataType === exports.DataType.JSON) {
            config.headers['Content-Type'] = 'application/json';
        }
        this.event.emit(exports.EventList.REQUEST, config, this);
        return HttpCrawler.http(config);
    }
    /**
     * 通过对象内_v的数组实现分离填充成数组
     * @param transformValue 使用transformValue方法处理后的对象
     */
    splitFull(transformValue) {
        if (!transformValue._v) {
            return [transformValue];
        }
        if (transformValue._v.length === 0) {
            return [transformValue];
        }
        return this.splitFullToArray(transformValue);
    }
    splitFullToArray(obj) {
        // console.log(obj);
        const _v = obj._v;
        const retArr = [];
        let maxLen = 1;
        for (let i = 0; i < maxLen; i++) {
            const _obj = deepEach(obj);
            _v.forEach((path) => {
                const arr = jmespath.search(obj, path);
                let fastEl = "";
                if (isArray(arr)) {
                    maxLen = (arr.length > maxLen) ? arr.length : maxLen;
                    if (arr.length <= 1) {
                        fastEl = arr[0];
                    }
                    else {
                        fastEl = arr.shift();
                    }
                }
                if (fastEl) {
                    const lastKeyIndex = path.lastIndexOf('.');
                    const lastKey = path.substring(lastKeyIndex + 1);
                    const otherPath = path.substring(0, lastKeyIndex);
                    // 这里只找父元素为对象的key，不找父元素为数组的情况
                    if (otherPath.length === 0) {
                        _obj[lastKey] = fastEl;
                    }
                    else {
                        const target = jmespath.search(_obj, otherPath);
                        target[lastKey] = fastEl;
                    }
                }
            });
            delete _obj._v;
            retArr.push(_obj);
        }
        return retArr;
    }
    /**
     * 合并所有步的结果
     */
    mergeResult() {
        const group = [];
        const fastResultSize = this.steps[0].results.length;
        for (let i = 0; i < fastResultSize; i++) {
            let obj = {};
            for (let j = 0; j < this.steps.length; j++) {
                const step = this.steps[j];
                const results = deepEach(step.results);
                const result = results[i];
                if (isObject(result)) {
                    if (step.key === 'default') {
                        obj = Object.assign(result, obj);
                    }
                    else {
                        obj[step.key] = result;
                    }
                }
                else {
                    obj[step.key] = result;
                }
            }
            group[i] = obj;
        }
        return group;
    }
    /**
     * 重置
     */
    reset() {
        this.state.current = 0;
        this.steps.map(step => {
            step.rawResults = [];
            step.responses = [];
            step.results = [];
        });
    }
    /**
     * 获取当前步
     */
    get $step() {
        return this.steps[this.state.current];
    }
    /**
     * 获取所有步
     */
    get $steps() {
        return this.steps;
    }
    /**
     * 获取元数据
     */
    get $meta() {
        return this.meta;
    }
    /**
     * 获取状态
     */
    get $state() {
        return this.state;
    }
    /**
     * 获取配置
     */
    get $option() {
        return this.option;
    }
    /**
     * 监听事件
     * @param event 监听事件，如：start、end、err、go:before、go:after
     * @param callback 回调函数
     */
    on(event, callback) {
        this.event.on(event, callback);
    }
}
HttpCrawler.http = Axios;

exports.HttpCrawler = HttpCrawler;
//# sourceMappingURL=http-crawler.cjs.js.map
