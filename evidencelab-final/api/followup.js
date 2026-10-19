const { answerFollowup } = require('../lib/engine');
const { readJsonBody, sendInputError } = require('../lib/http');
module.exports = function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.statusCode=405;return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED',message:'仅支持 POST。'}));}
  try{
    const body=readJsonBody(req);
    const question=String(body.question||'').trim();
    if(!question){res.statusCode=400;return res.end(JSON.stringify({error:'EMPTY_QUESTION',message:'请输入追问内容。'}));}
    if(question.length>500){res.statusCode=413;return res.end(JSON.stringify({error:'QUESTION_TOO_LONG',message:'追问不能超过 500 个字符。'}));}
    const answer=answerFollowup(question);
    const citations=[];
    if(/投资收益|非经常|一次性|归因|主因/.test(question))citations.push('O1','O2','S2','S3');
    else if(/现金流|应收|存货|回款/.test(question))citations.push('S4','U2');
    else if(/改变|反转|条件|阈值/.test(question))citations.push('CC1','CC2','CC3','CC4');
    res.statusCode=200;
    res.end(JSON.stringify({answer,citations,evidenceBounded:citations.length>0,missingInformation:citations.length?[]:['当前证据未覆盖该问题；需补充明确指标、报告期与原始来源。']}));
  }catch(error){if(sendInputError(res,error))return;res.statusCode=500;res.end(JSON.stringify({error:'FOLLOWUP_FAILED',message:'追问服务暂时不可用。'}));}
};
