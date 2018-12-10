import * as React from 'react';
import { Link as ReactRouterLink } from 'react-router-dom';
import styled from 'styled-components';

import { colors } from 'ts/style/colors';

interface LinkInterface {
    color?: string;
    children?: Node | string;
    isNoArrow?: boolean;
    hasIcon?: boolean | string;
    isBlock?: boolean;
    isCentered?: boolean;
    href?: string;
    theme?: {
        textColor: string;
    };
}

const StyledLink = styled(ReactRouterLink)<LinkInterface>`
    display: ${props => !props.isBlock && 'inline-flex'};
    color: ${props => props.color || props.theme.linkColor};
    text-align: center;
    font-size: 18px;
    text-decoration: none;
    align-items: center;

    @media (max-width: 768px) {
    }

    svg {
        margin-left: 3px;
    }
`;

export const Link = (props: LinkInterface) => {
    const {
        children,
        isNoArrow,
        href,
    } = props;

    return (
        <StyledLink to={href} {...props}>
            {children}
            {!isNoArrow && <svg width="25" height="25" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.484 5.246l.023 1.411 8.147.053L4.817 18.547l.996.996L17.65 7.706l.052 8.146 1.411.024-.068-10.561-10.561-.069z" fill="#00AE99"/></svg>}
        </StyledLink>
    );
};

// Added this, & + & doesnt really work since we switch with element types...
export const LinkWrap = styled.div`
    a + a,
    a + button,
    button + a {
        margin-left: 20px;
    }
`;
