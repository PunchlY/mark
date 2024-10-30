import { XmlNode } from '@rgrove/parse-xml';
import type { XmlText, XmlDocument, XmlElement, XmlCdata } from '@rgrove/parse-xml';

function getText({ children }: XmlElement) {
    let s = '';
    for (const e of children) {
        if (e.type === XmlNode.TYPE_TEXT || e.type === XmlNode.TYPE_CDATA)
            s += (e as XmlText | XmlCdata).text;
        else if (e.type === XmlNode.TYPE_ELEMENT)
            s += getText(e as XmlElement);
    }
    return s;
}

function* getElements({ children }: XmlElement | XmlDocument) {
    for (const e of children) {
        if (e.type !== XmlNode.TYPE_ELEMENT)
            continue;
        yield e as XmlElement;
    }
}

export { getText, getElements };
