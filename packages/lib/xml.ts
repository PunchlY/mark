import { XmlNode } from '@rgrove/parse-xml';
import type { XmlText, XmlDocument, XmlElement, XmlCdata } from '@rgrove/parse-xml';

function GetText({ children }: XmlElement) {
    let s = '';
    for (const e of children) {
        if (e.type === XmlNode.TYPE_TEXT || e.type === XmlNode.TYPE_CDATA)
            s += (e as XmlText | XmlCdata).text;
        else if (e.type === XmlNode.TYPE_ELEMENT)
            s += GetText(e as XmlElement);
    }
    return s;
}

function* GetElements({ children }: XmlElement | XmlDocument) {
    for (const e of children) {
        if (e.type !== XmlNode.TYPE_ELEMENT)
            continue;
        yield e as XmlElement;
    }
}

export { GetText, GetElements };
