import Axios, { AxiosResponse, AxiosRequestConfig } from 'axios';
import { Directive } from "./Directive";
import { State } from "./State";
import { Meta } from "./Meta";
import { Option } from "./Option";
import { Step, Request, DataType, MethodType } from "./Step";
import { deepEach, sleep, isArray, isObject } from "@app/utils"
import jmespath from 'jmespath';
import { stringify } from 'qs';
import { Event, EventList } from './Event';

export interface HttpCrawlerConfig {
  directive?: any;
  meta?: any;
  option?: any;
  steps: any[];
}

export class HttpCrawler {
  private directive: Directive;
  private meta: Meta;
  private option: Option;
  private state: State = new State();
  private steps: Step[] = [];
  private event: Event = new Event;

  constructor(config: HttpCrawlerConfig) {
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
  async run (meta?: Meta) {
    Object.assign(this.meta, meta);
    this.event.emit(EventList.START, this);
    for (let i = this.state.current; i < this.steps.length; i++) {
      await this.go();
    }
    const finalResults = this.mergeResult();
    this.event.emit(EventList.END, finalResults, this);
    return finalResults;
  }

  /**
   * 走一步
   * @param meta 元数据，可以通过指令来访问
   */
  async go (meta?: Meta) {
    Object.assign(this.meta, meta);
    /**
     * 1、将指令转化为值
     * 2、将多个值分离填充为多个对象
     * 3、整理出必要的属性，组成request对象
     * 4、发送所有的requests对象，并且将结果放到responses
     * 5、通过resultMode处理responses里的对象，并且存放到results里
     */
    
    const currentStep = this.$step;

    this.event.emit(EventList.GO_BEFORE,currentStep, this);

    const untreatedRequest: any = { //将要请求的对象
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
          this.event.emit(EventList.RESPONSE, currentStep.responses[i], this);
          currentStep.state.endTime = new Date();
          isRetry = false;
        } catch (error) {
          errRetry--;
          isRetry = true;
          this.event.emit(EventList.REQUEST_ERR, error, this);
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
      currentStep.results = currentStep.rawResults.reduce((prev: any, curr) => {
        if (isArray(curr)) {
          prev.push(...curr);
        } else {
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
    
    this.event.emit(EventList.GO_AFTER,currentStep ,this);
    return currentStep.results;
  }

  /**
   * 发送请求
   * @param req 进行网络请求
   */
  request (req: Request): Promise<AxiosResponse> {
    const config: AxiosRequestConfig = {};
    config.url = req.url;
    config.headers = req.header;
    config.data = req.data;
    config.params = req.params;
    config.method = req.method;
    config.timeout = this.option.timeout;
    if (req.method === MethodType.POST && req.dataType === DataType.FORMDATA) {
      config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      config.data = stringify(config.data);
    } else if (req.method === MethodType.POST && req.dataType === DataType.JSON) {
      config.headers['Content-Type'] = 'application/json';
    }
    this.event.emit(EventList.REQUEST, config, this);
    return HttpCrawler.http(config);
  }

  /**
   * 通过对象内_v的数组实现分离填充成数组
   * @param transformValue 使用transformValue方法处理后的对象
   */
  splitFull (transformValue: any) {
    if (!transformValue._v) {
      return [transformValue];
    }
    if (transformValue._v.length === 0) {
      return [transformValue];
    }
    return this.splitFullToArray(transformValue);
  }
  splitFullToArray (obj: any) {
    // console.log(obj);
    
    const _v = obj._v;
    const retArr = [];
    let maxLen = 1;
    for (let i = 0; i < maxLen; i++) {
      const _obj = deepEach(obj);
      _v.forEach((path: any) => {

        const arr = jmespath.search(obj, path);
        let fastEl = "";
        if (isArray(arr)) {
          maxLen = (arr.length > maxLen) ? arr.length : maxLen;
          if (arr.length <= 1) {
            fastEl = arr[0];
          } else {
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
          } else {
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
  mergeResult () {
    const group = [];
    const fastResultSize = this.steps[0].results.length;
    for (let i = 0; i < fastResultSize; i++) {
      let obj: any = {};
      for (let j = 0; j < this.steps.length; j++) {
        const step = this.steps[j]
        const results = deepEach(step.results);
        const result = results[i];
        if (isObject(result)) {
          if (step.key === 'default') {
            obj = Object.assign(result, obj);
          } else {
            obj[step.key] = result;
          }
        } else {
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
  reset () {
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
  get $step () {
    return this.steps[this.state.current];
  }
  /**
   * 获取所有步
   */
  get $steps () {
    return this.steps;
  }

  /**
   * 获取元数据
   */
  get $meta () {
    return this.meta;
  }

  /**
   * 获取状态
   */
  get $state () {
    return this.state;
  }

  /**
   * 获取配置
   */
  get $option () {
    return this.option;
  }

  /**
   * 监听事件
   * @param event 监听事件，如：start、end、err、go:before、go:after
   * @param callback 回调函数
   */
  on (event: EventList, callback: (...args: any[]) => void) {
    this.event.on(event, callback);
  }

  static http = Axios;
}

