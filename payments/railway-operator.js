'use strict';

const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function railwayOperatorClient(env = process.env, execute = promisify(execFile)) {
  const project = env.TASKMALL_RAILWAY_PROJECT_ID;
  const service = env.TASKMALL_RAILWAY_SERVICE_ID;
  const environment = env.TASKMALL_RAILWAY_ENVIRONMENT_ID;
  if (![project, service, environment].every(value => uuid.test(value || ''))) throw new Error('RAILWAY_OPERATOR_IDENTITY_REQUIRED');
  const cli = env.TASKMALL_RAILWAY_CLI_FILE || (process.platform === 'win32'
    ? path.join(env.APPDATA || '', 'npm', 'node_modules', '@railway', 'cli', 'bin', 'railway.exe') : 'railway');
  return async (route, body) => {
    const read = body === undefined && ['collections', 'withdrawals'].includes(route);
    const write = body !== undefined && (route === 'collections/plan' || /^collections\/[a-f0-9-]{36}\/record$/.test(route));
    if (!read && !write) throw new Error('RAILWAY_OPERATOR_ROUTE_NOT_ALLOWED');
    if (write && (!body || typeof body !== 'object' || Array.isArray(body))) throw new Error('RAILWAY_OPERATOR_INVALID_BODY');
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined && Buffer.byteLength(payload) > 1_000_000) throw new Error('RAILWAY_OPERATOR_REQUEST_TOO_LARGE');
    // The operator credential stays on the authenticated host; only public transaction bytes may cross SSH.
    const source = `(async()=>{
      if(process.env.RAILWAY_PROJECT_ID!==${JSON.stringify(project)}||process.env.RAILWAY_SERVICE_ID!==${JSON.stringify(service)}
        ||process.env.RAILWAY_ENVIRONMENT_ID!==${JSON.stringify(environment)})throw new Error('WRONG_OPERATOR_SERVICE');
      const port=Number(process.env.PORT);const token=process.env.TASKMALL_OPERATOR_TOKEN;
      if(!Number.isInteger(port)||port<1||port>65535||!token||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('OPERATOR_CONFIGURATION_UNAVAILABLE');
      const response=await fetch('http://127.0.0.1:'+port+'/api/operator/'+${JSON.stringify(route)},
        {method:${JSON.stringify(read ? 'GET' : 'POST')},redirect:'error',signal:AbortSignal.timeout(15000),
          headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
          ${payload === undefined ? '' : `body:${JSON.stringify(payload)},`}});
      console.log(JSON.stringify({status:response.status,result:await response.json()}));
    })().catch(()=>{console.log(JSON.stringify({status:503,result:{error:'RAILWAY_OPERATOR_UNAVAILABLE'}}));});`;
    const capsule = `eval(Buffer.from("${Buffer.from(source).toString('base64')}","base64").toString("utf8"))`;
    let response;
    try {
      const { stdout } = await execute(cli, ['ssh', '-p', project, '-s', service, '-e', environment, '--', `node -e '${capsule}'`],
        { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 });
      response = JSON.parse(stdout.trim());
      if (!Number.isInteger(response.status) || !response.result || typeof response.result !== 'object') throw new Error();
    } catch { throw new Error('RAILWAY_OPERATOR_UNAVAILABLE'); }
    if (response.status < 200 || response.status >= 300) {
      const code = response.result.error;
      throw new Error(typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'RAILWAY_OPERATOR_REQUEST_FAILED');
    }
    return response.result;
  };
}

module.exports = { railwayOperatorClient };
