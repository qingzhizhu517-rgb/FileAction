"""逐段解码 JSON 根字段中的文字；未完成字段不作为可执行结果。"""
import json

FIELDS = {'summary', 'response', 'overview', 'positioning', 'title', 'markdown'}

def partial_string(raw):
    out=[];i=0
    escapes={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'}
    while i<len(raw):
        c=raw[i]
        if c!='\\':
            code=ord(c)
            if 0xD800<=code<=0xDBFF:
                if i+1>=len(raw):break
                low=ord(raw[i+1])
                if not 0xDC00<=low<=0xDFFF:raise ValueError('surrogate')
                out.append(chr(0x10000+((code-0xD800)<<10)+low-0xDC00));i+=2;continue
            if 0xDC00<=code<=0xDFFF:raise ValueError('surrogate')
            out.append(c);i+=1;continue
        if i+1>=len(raw):break
        escape=raw[i+1]
        if escape in escapes:out.append(escapes[escape]);i+=2;continue
        if escape!='u':raise ValueError('escape')
        if i+6>len(raw):break
        code=int(raw[i+2:i+6],16);length=6
        if 0xD800<=code<=0xDBFF:
            if i+12>len(raw):break
            if raw[i+6:i+8]!='\\u':raise ValueError('surrogate')
            low=int(raw[i+8:i+12],16)
            if not 0xDC00<=low<=0xDFFF:raise ValueError('surrogate')
            code=0x10000+((code-0xD800)<<10)+low-0xDC00;length=12
        elif 0xDC00<=code<=0xDFFF:raise ValueError('surrogate')
        out.append(chr(code));i+=length
    return ''.join(out)

class JSONTextStream:
    def __init__(self,on_text):
        self.on_text=on_text;self.depth=0;self.in_string=False;self.escaped=False
        self.phase='key';self.key=None;self.is_key=False;self.field=None;self.raw='';self.sent=0
    def _emit(self):
        if self.field:
            value=partial_string(self.raw)
            if len(value)>self.sent:
                self.on_text(self.field,value[self.sent:]);self.sent=len(value)
    def feed(self,chunk):
        for c in chunk:
            if self.in_string:
                if c=='"' and not self.escaped:
                    self._emit()
                    if self.is_key:self.key=json.loads('"'+self.raw+'"');self.phase='colon'
                    elif self.depth==1:self.phase='after'
                    self.in_string=False;self.field=None;continue
                self.raw+=c
                if self.escaped:self.escaped=False
                elif c=='\\':self.escaped=True
                continue
            if c=='"':
                self.in_string=True;self.escaped=False;self.raw='';self.sent=0
                self.is_key=self.depth==1 and self.phase=='key'
                self.field=self.key if self.depth==1 and self.phase=='value' and self.key in FIELDS else None
            elif c in '{[':
                self.depth+=1
                if self.depth==1:self.phase='key'
            elif c in '}]':self.depth-=1
            elif self.depth==1:
                if c==':':self.phase='value'
                elif c==',':self.phase='key';self.key=None
        self._emit()
