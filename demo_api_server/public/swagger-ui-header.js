(function addSwaggerDemoHeader() {
    'use strict';

    function renderHeader() {
        if (document.querySelector('.swagger-demo-header')) return;

        var header = document.createElement('header');
        header.className = 'swagger-demo-header';
        header.innerHTML = [
            '<div class="swagger-demo-header__brand">',
            '<span class="swagger-demo-header__logo" aria-hidden="true">🏦</span>',
            '<strong>Banking Demo API</strong>',
            '</div>',
            '<a class="swagger-demo-header__login" href="#">Sign in with PingOne</a>',
        ].join('');

        header.querySelector('.swagger-demo-header__login').addEventListener('click', function (event) {
            event.preventDefault();
            var returnTo = window.location.pathname + window.location.search;
            window.location.href = '/api/auth/oauth/login?return_to=' + encodeURIComponent(returnTo);
        });

        document.body.insertBefore(header, document.body.firstChild);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderHeader);
    } else {
        renderHeader();
    }
}());
