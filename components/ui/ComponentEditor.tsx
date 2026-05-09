/**
 * Component Editor
 * Inline bulk editor for components with search, filter, sort, and before/after diff.
 */
'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from './LoadingSkeleton';
import SpecRenderer from './SpecRenderer';
import type { Component, PriceQuoteLineItem, PriceQuote, PurchaseOrder, PurchaseLineItem, CompetitorPrice, POCost, ComponentLink } from '../../types/database';
import { PRINCIPAL_CATS, BALANCE_CATS, BANK_FEE_CATS, TAX_CATS } from '../../constants/costCategories';
import { ENUMS } from '../../constants/enums';